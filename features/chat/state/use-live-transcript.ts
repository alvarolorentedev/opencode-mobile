import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { stringField } from '@/shared/protocol/opencode/v2/fields';
import { isV2Client } from '@/shared/protocol/opencode/contracts/contract';
import {
  liveTranscriptRecord,
  overlayLiveRecords,
  reduceLiveEvent,
  seedLiveMessage,
  userMessageRecord,
  type LiveTranscriptMessage,
} from '@/features/chat/model/live-transcript';

// One paint per frame budget keeps token deltas from triggering a React render
// per streamed chunk.
const PAINT_INTERVAL_MS = 50;
const LOCAL_SEND_WINDOW_MS = 15_000;

type Input = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  messagesBySessionRef: { current: Record<string, SessionMessageRecord[]> };
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  recordUsageAndTodos: (sessionId: string, records: SessionMessageRecord[]) => void;
};

export function useLiveTranscript({ client, isCurrentClient, messagesBySessionRef, setMessagesBySession, recordUsageAndTodos }: Input) {
  const liveRef = useRef<Map<string, Map<string, LiveTranscriptMessage>>>(new Map());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ledgerRef = useRef<Set<string>>(new Set());
  const localSendsRef = useRef<Map<string, number>>(new Map());
  // A prompt this client admitted is painted immediately. Keep it until a
  // rewrite or session close so a page read that started before admission
  // cannot remove it.
  const localUsersRef = useRef<Map<string, SessionMessageRecord[]>>(new Map());

  useEffect(() => () => {
    for (const timer of Object.values(timersRef.current)) clearTimeout(timer);
    timersRef.current = {};
  }, []);

  const flush = useCallback((sessionId: string) => {
    delete timersRef.current[sessionId];
    const session = liveRef.current.get(sessionId);
    if (!session) return;
    const messages = [...session.values()];
    setMessagesBySession((current) => {
      const previous = current[sessionId];
      if (!previous?.length) return current;
      const next = overlayLiveRecords(previous, messages);
      return next === previous ? current : { ...current, [sessionId]: next };
    });
    if (ledgerRef.current.delete(sessionId)) {
      recordUsageAndTodos(sessionId, messages.map(liveTranscriptRecord));
    }
  }, [recordUsageAndTodos, setMessagesBySession]);

  const scheduleFlush = useCallback((sessionId: string) => {
    if (timersRef.current[sessionId]) return;
    timersRef.current[sessionId] = setTimeout(() => flush(sessionId), PAINT_INTERVAL_MS);
  }, [flush]);

  const applyEvent = useCallback((event: OpencodeEvent) => {
    if (!isV2Client(client) || !isCurrentClient(client)) return false;
    if (event.type === 'compatibility' || !('data' in event)) return false;
    const data = event.data as Record<string, unknown>;
    const sessionId = stringField(data.sessionID);
    if (!sessionId) return false;
    const session = liveRef.current.get(sessionId);
    if (event.type === 'session.usage.updated') return true;
    const messageId = stringField(data.assistantMessageID);
    if (!messageId) return false;
    if (!session?.has(messageId) && !messagesBySessionRef.current[sessionId]?.length) return false;
    const held = messagesBySessionRef.current[sessionId]?.find((record) => record.info.id === messageId);
    const previous = session?.get(messageId) ?? (held ? seedLiveMessage(held) : undefined);
    const result = reduceLiveEvent(previous, event);
    if (result.kind === 'consumed') return true;
    if (result.kind !== 'update') return false;
    const target = session ?? new Map<string, LiveTranscriptMessage>();
    target.set(messageId, result.message);
    liveRef.current.set(sessionId, target);
    if (result.ledger) ledgerRef.current.add(sessionId);
    scheduleFlush(sessionId);
    return true;
  }, [client, isCurrentClient, messagesBySessionRef, scheduleFlush]);

  const activeMessageId = useCallback((sessionId: string) => {
    let latest: LiveTranscriptMessage | undefined;
    for (const message of liveRef.current.get(sessionId)?.values() ?? []) {
      if (!latest || message.created >= latest.created) latest = message;
    }
    return latest?.messageID;
  }, []);

  const clearMessage = useCallback((sessionId: string, messageId: string) => {
    const session = liveRef.current.get(sessionId);
    if (!session) return;
    session.delete(messageId);
    if (session.size === 0) liveRef.current.delete(sessionId);
    const timer = timersRef.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[sessionId];
    }
  }, []);

  const clearSession = useCallback((sessionId: string) => {
    liveRef.current.delete(sessionId);
    ledgerRef.current.delete(sessionId);
    localUsersRef.current.delete(sessionId);
    const timer = timersRef.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[sessionId];
    }
  }, []);

  const overlay = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    const session = liveRef.current.get(sessionId);
    const withLive = session ? overlayLiveRecords(records, [...session.values()]) : records;
    const localUsers = localUsersRef.current.get(sessionId);
    if (!localUsers?.length) return withLive;
    let next = withLive;
    for (const local of localUsers) {
      const index = next.findIndex((record) => record.info.id === local.info.id);
      if (index >= 0) {
        if (next[index].parts === local.parts) continue;
        next = next.slice();
        next[index] = local;
        continue;
      }
      const tail = next[next.length - 1];
      if (!tail || local.info.time.created >= tail.info.time.created) next = [...next, local];
    }
    return next;
  }, []);

  const adopt = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    const localUsers = localUsersRef.current.get(sessionId);
    if (!localUsers?.length) return;
    const known = new Set(records.map((record) => record.info.id));
    const remaining = localUsers.filter((record) => !known.has(record.info.id));
    if (remaining.length === localUsers.length) return;
    if (remaining.length === 0) localUsersRef.current.delete(sessionId);
    else localUsersRef.current.set(sessionId, remaining);
  }, []);

  const appendUserMessage = useCallback((sessionId: string, input: {
    id: string;
    createdAt: number;
    text: string;
    attachments: { url: string; mime?: string; filename?: string }[];
  }) => {
    const record = userMessageRecord({ sessionID: sessionId, ...input });
    const local = localUsersRef.current.get(sessionId) ?? [];
    localUsersRef.current.set(sessionId, [...local.filter((item) => item.info.id !== input.id), record]);
    setMessagesBySession((current) => {
      const previous = current[sessionId];
      if (previous?.some((item) => item.info.id === input.id)) return current;
      return { ...current, [sessionId]: [...(previous ?? []), record] };
    });
  }, [setMessagesBySession]);

  const markLocalSend = useCallback((sessionId: string) => {
    localSendsRef.current.set(sessionId, Date.now());
  }, []);

  const isLocalSendRecent = useCallback((sessionId: string) => {
    const sentAt = localSendsRef.current.get(sessionId);
    if (sentAt === undefined) return false;
    if (Date.now() - sentAt > LOCAL_SEND_WINDOW_MS) {
      localSendsRef.current.delete(sessionId);
      return false;
    }
    return true;
  }, []);

  const reset = useCallback(() => {
    liveRef.current.clear();
    ledgerRef.current.clear();
    localSendsRef.current.clear();
    localUsersRef.current.clear();
    for (const timer of Object.values(timersRef.current)) clearTimeout(timer);
    timersRef.current = {};
  }, []);

  const prune = useCallback((keepIds: Set<string>) => {
    for (const sessionId of new Set([...liveRef.current.keys(), ...localUsersRef.current.keys()])) {
      if (!keepIds.has(sessionId)) clearSession(sessionId);
    }
  }, [clearSession]);

  return useMemo(() => ({ applyEvent, activeMessageId, clearMessage, clearSession, overlay, adopt, appendUserMessage, markLocalSend, isLocalSendRecent, reset, prune }),
    [adopt, applyEvent, activeMessageId, appendUserMessage, clearMessage, clearSession, isLocalSendRecent, markLocalSend, overlay, prune, reset]);
}
