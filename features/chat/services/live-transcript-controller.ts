import type { AppCore } from '@/runtime/core';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { stringField } from '@/shared/protocol/opencode/v2/fields';
import { isV2Client } from '@/shared/protocol/opencode/contracts/contract';
import {
  getLiveTranscriptBuffer,
  liveTranscriptRecord,
  reduceLiveEvent,
  seedLiveMessage,
  userMessageRecord,
  type LiveTranscriptMessage,
} from '@/features/chat/model/live-transcript';
import { overlayTranscriptSession } from '../model/live-transcript-view';

// One paint per frame budget keeps token deltas from triggering a React render
// per streamed chunk.
const PAINT_INTERVAL_MS = 50;
const LOCAL_SEND_WINDOW_MS = 15_000;
const EMPTY_RECORDS: SessionMessageRecord[] = [];

export type LiveTranscriptInput = {
  scopeKey: string;
  partition?: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  readCanonicalSession: (sessionId: string) => SessionMessageRecord[];
  recordUsageAndTodos: (sessionId: string, records: SessionMessageRecord[]) => void;
};

export function createLiveTranscript({ store, clock, scopeKey, partition, client, isCurrentClient, readCanonicalSession, recordUsageAndTodos }:
  LiveTranscriptInput & Pick<AppCore, 'store' | 'clock'>) {
  const scopes = store.getState().transcriptLive;
  const readBuffer = () => {
    const buffer = scopes.get(scopeKey);
    return !buffer?.partition || buffer.partition === partition ? buffer : undefined;
  };
  // Stream events write synchronously to the store's buffer. Only a paint
  // revision notifies React, so token deltas do not wake every subscriber.
  const ensureBuffer = () => {
    const previous = scopes.get(scopeKey);
    if (previous?.partition && previous.partition !== partition) scopes.delete(scopeKey);
    const buffer = getLiveTranscriptBuffer(scopes, scopeKey);
    buffer.partition = partition;
    return buffer;
  };
  const paint = () => store.getState().setTranscriptUi(scopeKey, (current) => ({ paintRevision: current.paintRevision + 1 }));
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const ledger = new Set<string>();

  const flush = (sessionId: string) => {
    delete timers[sessionId];
    const session = readBuffer()?.messages.get(sessionId);
    if (!session) return;
    paint();
    if (ledger.delete(sessionId)) {
      recordUsageAndTodos(sessionId, [...session.values()].map(liveTranscriptRecord));
    }
  };

  const scheduleFlush = (sessionId: string) => {
    if (timers[sessionId]) return;
    timers[sessionId] = setTimeout(() => flush(sessionId), PAINT_INTERVAL_MS);
  };

  const applyEvent = (event: OpencodeEvent) => {
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
    const owner = buffer?.partition === partition && buffer ? buffer : ensureBuffer();
    owner.messages.set(sessionId, target);
    if (result.ledger) ledger.add(sessionId);
    scheduleFlush(sessionId);
    return true;
  };

  const activeMessageId = (sessionId: string) => {
    let latest: LiveTranscriptMessage | undefined;
    for (const message of readBuffer()?.messages.get(sessionId)?.values() ?? []) {
      if (!latest || message.created >= latest.created) latest = message;
    }
    return latest?.messageID;
  };

  const clearMessage = (sessionId: string, messageId: string) => {
    const buffer = readBuffer();
    const messages = buffer?.messages;
    const pending = buffer?.reconcileOnPage.get(sessionId);
    pending?.delete(messageId);
    if (pending?.size === 0) buffer?.reconcileOnPage.delete(sessionId);
    const session = messages?.get(sessionId);
    if (!session?.delete(messageId)) return;
    if (session.size === 0) {
      messages?.delete(sessionId);
      const timer = timers[sessionId];
      if (timer) clearTimeout(timer);
      delete timers[sessionId];
      ledger.delete(sessionId);
    }
    paint();
  };

  const deferReconcileToPage = (sessionId: string, messageId: string) => {
    const buffer = readBuffer();
    if (!buffer?.messages.get(sessionId)?.has(messageId)) return;
    const pending = buffer.reconcileOnPage.get(sessionId) ?? new Set();
    pending.add(messageId);
    buffer.reconcileOnPage.set(sessionId, pending);
  };

  const clearSession = (sessionId: string) => {
    const buffer = readBuffer();
    const messagesRemoved = buffer?.messages.delete(sessionId);
    const localRemoved = buffer?.localUsers.delete(sessionId);
    buffer?.reconcileOnPage.delete(sessionId);
    ledger.delete(sessionId);
    const timer = timers[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete timers[sessionId];
    }
    if (messagesRemoved || localRemoved) paint();
  };

  const overlay = (sessionId: string, records: SessionMessageRecord[]) => {
    return overlayTranscriptSession(readBuffer(), sessionId, records);
  };

  const adopt = (sessionId: string, page: SessionMessageRecord[] = EMPTY_RECORDS) => {
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
  };

  const appendUserMessage = (sessionId: string, input: {
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
  };

  const hasLocalUsers = (sessionId: string) => Boolean(readBuffer()?.localUsers.get(sessionId)?.length);

  const isLocalSendRecent = (sessionId: string) => {
    const timestamps = readBuffer()?.localSends;
    const sentAt = timestamps?.get(sessionId);
    if (sentAt === undefined) return false;
    if (clock() - sentAt > LOCAL_SEND_WINDOW_MS) {
      timestamps?.delete(sessionId);
      return false;
    }
    return true;
  };

  const reset = () => {
    const hadBuffer = Boolean(readBuffer()) && scopes.delete(scopeKey);
    ledger.clear();
    for (const timer of Object.values(timers)) clearTimeout(timer);
    for (const id of Object.keys(timers)) delete timers[id];
    if (hadBuffer) paint();
  };

  const prune = (keepIds: Set<string>) => {
    const buffer = readBuffer();
    if (!buffer) return;
    for (const sessionId of new Set([...buffer.messages.keys(), ...buffer.localUsers.keys()])) {
      if (!keepIds.has(sessionId)) clearSession(sessionId);
    }
  };

  function dispose() { reset(); }
  return {
    applyEvent, activeMessageId, clearMessage, clearSession, deferReconcileToPage, overlay, adopt, appendUserMessage,
    hasLocalUsers, isLocalSendRecent, reset, prune, dispose,
  };
}
