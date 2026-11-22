import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { stringField } from '@/shared/protocol/opencode/v2/fields';
import { isV2Client } from '@/shared/protocol/opencode/contracts/contract';
import {
  getLiveTranscriptBuffer,
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
const EMPTY_RECORDS: SessionMessageRecord[] = [];

type Input = {
  scopeKey: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  readCanonicalSession: (sessionId: string) => SessionMessageRecord[];
  recordUsageAndTodos: (sessionId: string, records: SessionMessageRecord[]) => void;
};

export function useLiveTranscript({ scopeKey, client, isCurrentClient, messagesBySession, readCanonicalSession, recordUsageAndTodos }: Input) {
  const { store } = useAppCore();
  const scopes = store.getState().transcriptLive;
  const paintRevision = useAppStore((state) => state.transcriptUi[scopeKey]?.paintRevision ?? 0);
  const readBuffer = useCallback(() => scopes.get(scopeKey), [scopeKey, scopes]);
  // Stream events write synchronously to the store's buffer. Only a paint
  // revision notifies React, so token deltas do not wake every subscriber.
  const ensureBuffer = useCallback(() => getLiveTranscriptBuffer(scopes, scopeKey), [scopeKey, scopes]);
  const paint = useCallback(() => store.getState().setTranscriptUi(scopeKey, (current) => ({ paintRevision: current.paintRevision + 1 })), [scopeKey, store]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ledgerRef = useRef<Set<string>>(new Set());

  useEffect(() => () => {
    for (const timer of Object.values(timersRef.current)) clearTimeout(timer);
    timersRef.current = {};
    ledgerRef.current.clear();
    scopes.delete(scopeKey);
  }, [scopeKey, scopes]);

  const flush = useCallback((sessionId: string) => {
    delete timersRef.current[sessionId];
    const session = readBuffer()?.messages.get(sessionId);
    if (!session) return;
    paint();
    if (ledgerRef.current.delete(sessionId)) {
      recordUsageAndTodos(sessionId, [...session.values()].map(liveTranscriptRecord));
    }
  }, [paint, readBuffer, recordUsageAndTodos]);

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
    const buffer = readBuffer();
    const session = buffer?.messages.get(sessionId);
    if (event.type === 'session.usage.updated') return true;
    const messageId = stringField(data.assistantMessageID);
    if (!messageId) return false;
    const records = readCanonicalSession(sessionId);
    if (!session?.has(messageId) && !records?.length && !buffer?.localUsers.get(sessionId)?.length) return false;
    const held = records?.find((record) => record.info.id === messageId);
    const previous = session?.get(messageId) ?? (held ? seedLiveMessage(held) : undefined);
    const result = reduceLiveEvent(previous, event);
    if (result.kind === 'consumed') return true;
    if (result.kind !== 'update') return false;
    const target = session ?? new Map<string, LiveTranscriptMessage>();
    target.set(messageId, result.message);
    (buffer ?? ensureBuffer()).messages.set(sessionId, target);
    if (result.ledger) ledgerRef.current.add(sessionId);
    scheduleFlush(sessionId);
    return true;
  }, [client, ensureBuffer, isCurrentClient, readBuffer, readCanonicalSession, scheduleFlush]);

  const activeMessageId = useCallback((sessionId: string) => {
    let latest: LiveTranscriptMessage | undefined;
    for (const message of readBuffer()?.messages.get(sessionId)?.values() ?? []) {
      if (!latest || message.created >= latest.created) latest = message;
    }
    return latest?.messageID;
  }, [readBuffer]);

  const clearMessage = useCallback((sessionId: string, messageId: string) => {
    const buffer = readBuffer();
    const messages = buffer?.messages;
    const pending = buffer?.reconcileOnPage.get(sessionId);
    pending?.delete(messageId);
    if (pending?.size === 0) buffer?.reconcileOnPage.delete(sessionId);
    const session = messages?.get(sessionId);
    if (!session?.delete(messageId)) return;
    if (session.size === 0) {
      messages?.delete(sessionId);
      const timer = timersRef.current[sessionId];
      if (timer) clearTimeout(timer);
      delete timersRef.current[sessionId];
      ledgerRef.current.delete(sessionId);
    }
    paint();
  }, [paint, readBuffer]);

  const deferReconcileToPage = useCallback((sessionId: string, messageId: string) => {
    const buffer = readBuffer();
    if (!buffer?.messages.get(sessionId)?.has(messageId)) return;
    const pending = buffer.reconcileOnPage.get(sessionId) ?? new Set();
    pending.add(messageId);
    buffer.reconcileOnPage.set(sessionId, pending);
  }, [readBuffer]);

  const clearSession = useCallback((sessionId: string) => {
    const buffer = readBuffer();
    const messagesRemoved = buffer?.messages.delete(sessionId);
    const localRemoved = buffer?.localUsers.delete(sessionId);
    buffer?.reconcileOnPage.delete(sessionId);
    ledgerRef.current.delete(sessionId);
    const timer = timersRef.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[sessionId];
    }
    if (messagesRemoved || localRemoved) paint();
  }, [paint, readBuffer]);

  const overlay = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    const buffer = readBuffer();
    const session = buffer?.messages.get(sessionId);
    const localUsers = buffer?.localUsers.get(sessionId);
    let next = records;
    for (const local of localUsers ?? EMPTY_RECORDS) {
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
    return session ? overlayLiveRecords(next, [...session.values()]) : next;
  }, [readBuffer]);

  const adopt = useCallback((sessionId: string, page: SessionMessageRecord[] = EMPTY_RECORDS) => {
    const buffer = readBuffer();
    const users = buffer?.localUsers;
    const localUsers = users?.get(sessionId);
    const pending = buffer?.reconcileOnPage.get(sessionId);
    if (pending?.size) {
      for (const { info } of page) {
        if (info.role === 'assistant' && info.time.completed !== undefined && pending.has(info.id)) clearMessage(sessionId, info.id);
      }
    }
    if (!localUsers?.length) return;
    const records = readCanonicalSession(sessionId) ?? EMPTY_RECORDS;
    const known = new Set(records.map((record) => record.info.id));
    const remaining = localUsers.filter((record) => !known.has(record.info.id));
    if (remaining.length === localUsers.length) return;
    if (remaining.length === 0) users?.delete(sessionId);
    else users?.set(sessionId, remaining);
    paint();
  }, [clearMessage, paint, readBuffer, readCanonicalSession]);

  const appendUserMessage = useCallback((sessionId: string, input: {
    id: string;
    createdAt: number;
    text: string;
    attachments: { url: string; mime?: string; filename?: string }[];
  }) => {
    if (readCanonicalSession(sessionId)?.some((item) => item.info.id === input.id)) return;
    const users = ensureBuffer().localUsers;
    const local = users.get(sessionId) ?? EMPTY_RECORDS;
    users.set(sessionId, [...local.filter((item) => item.info.id !== input.id), userMessageRecord({ sessionID: sessionId, ...input })]);
    paint();
  }, [ensureBuffer, paint, readCanonicalSession]);

  const hasLocalUsers = useCallback((sessionId: string) => Boolean(readBuffer()?.localUsers.get(sessionId)?.length), [readBuffer]);

  const isLocalSendRecent = useCallback((sessionId: string) => {
    const timestamps = readBuffer()?.localSends;
    const sentAt = timestamps?.get(sessionId);
    if (sentAt === undefined) return false;
    if (Date.now() - sentAt > LOCAL_SEND_WINDOW_MS) {
      timestamps?.delete(sessionId);
      return false;
    }
    return true;
  }, [readBuffer]);

  const reset = useCallback(() => {
    const hadBuffer = scopes.delete(scopeKey);
    ledgerRef.current.clear();
    for (const timer of Object.values(timersRef.current)) clearTimeout(timer);
    timersRef.current = {};
    if (hadBuffer) paint();
  }, [paint, scopeKey, scopes]);

  const prune = useCallback((keepIds: Set<string>) => {
    const buffer = readBuffer();
    if (!buffer) return;
    for (const sessionId of new Set([...buffer.messages.keys(), ...buffer.localUsers.keys()])) {
      if (!keepIds.has(sessionId)) clearSession(sessionId);
    }
  }, [clearSession, readBuffer]);

  const actions = useMemo(() => ({ applyEvent, activeMessageId, clearMessage, clearSession, deferReconcileToPage, overlay, adopt, appendUserMessage, hasLocalUsers, isLocalSendRecent, reset, prune }),
    [adopt, applyEvent, activeMessageId, appendUserMessage, clearMessage, clearSession, deferReconcileToPage, hasLocalUsers, isLocalSendRecent, overlay, prune, reset]);
  const readDisplayedSession = useCallback((sessionId: string) => overlay(sessionId, readCanonicalSession(sessionId) ?? EMPTY_RECORDS), [overlay, readCanonicalSession]);
  const displayedMessages = useMemo(() => {
    const buffer = readBuffer();
    const canonical = messagesBySession;
    if (!buffer) return canonical;
    const sessions = new Set([...buffer.messages.keys(), ...buffer.localUsers.keys()]);
    if (!sessions.size) return canonical;
    const displayed = { ...canonical };
    for (const sessionId of sessions) displayed[sessionId] = overlay(sessionId, canonical[sessionId] ?? EMPTY_RECORDS);
    return displayed;
  // Query and the paint revision publish changes to their respective sources.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesBySession, overlay, paintRevision, readBuffer]);

  return { actions, displayedMessages, readDisplayedSession };
}
