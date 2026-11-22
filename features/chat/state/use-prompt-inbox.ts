import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useAppCore, useAppStore, type PromptOutbox } from '@/runtime/core';
import { getErrorMessage } from '@/shared/utilities/error-message';
import { classifyConnectionFailure } from '@/shared/protocol/opencode/client/errors';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { PromptPreparationError, type PendingNotice, type PendingPrompt, type PromptDelivery, type PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import type { TranscriptReadOptions } from '@/shared/contracts/domain';
import { getSessionInbox, getSessionNotices, submitLegacyPrompt } from '@/shared/protocol/services/session-service';
import { useQueryIdentity } from '@/shared/server-data/client';

import { promptInboxKey } from '../services/queries';

const EMPTY_PROMPTS: Record<string, PendingPrompt[]> = {};
const EMPTY_NOTICES: Record<string, PendingNotice[]> = {};

type PromptSnapshot = { prompts: Record<string, PendingPrompt[]>; notices: Record<string, PendingNotice[]> };
const EMPTY_SNAPSHOT: PromptSnapshot = { prompts: EMPTY_PROMPTS, notices: EMPTY_NOTICES };
const EMPTY_OUTBOX: PromptOutbox = { sequence: 0, bySession: {} };

function mergePrompts(server: PendingPrompt[], local: PromptOutbox['bySession'][string]) {
  return [...local.map(({ prompt }) => prompt), ...server].sort((a, b) => a.createdAt - b.createdAt);
}

function promptText(input: PromptInput) {
  return (input.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
}

function isUncertainDelivery(error: unknown) {
  // A validation/HTTP 4xx error is not a delivery uncertainty. Only a
  // transport-shaped failure can have reached the server without a response.
  const status = (error as { status?: number; cause?: { status?: number } } | undefined)?.status
    ?? (error as { cause?: { status?: number } } | undefined)?.cause?.status;
  // A definite HTTP response means the server answered. Treat it as a normal
  // failure (restore the draft / surface the error), never as an uncertain
  // delivery that might be replayed.
  if (status !== undefined) return false;
  const kind = classifyConnectionFailure(error);
  if (kind === 'offline' || kind === 'timeout' || kind === 'tunnel-startup') return true;
  // Some native transports only report a generic fetch failure.
  return /fetch failed|failed to fetch|network request failed|network unavailable|timed? ?out|connection (?:closed|reset|failed)/i.test(
    getErrorMessage(error),
  );
}

function canQueueAfterFailure(error: unknown) {
  return error instanceof PromptPreparationError && isUncertainDelivery(error.cause);
}

export function usePromptInbox({
  client,
  queueScope,
  isCurrentClient,
  refreshMessages: readMessages,
  appendUserMessage,
  connected = true,
  online = true,
}: {
  client: ScopedOpencodeClient;
  queueScope: string;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;
  appendUserMessage?: (sessionId: string, input: {
    id: string;
    createdAt: number;
    text: string;
    attachments: { url: string; mime?: string; filename?: string }[];
  }) => void;
  connected?: boolean;
  online?: boolean;
}) {
  const scope = queueScope;
  const { store } = useAppCore();
  const { connectionId, connectionScope, authRevision } = useQueryIdentity();
  const cache = useQueryClient();
  const key = useMemo(() => promptInboxKey({ connectionId, connectionScope, authRevision }, client), [authRevision, client, connectionId, connectionScope]);
  const { data: snapshot = EMPTY_SNAPSHOT } = useQuery<PromptSnapshot>({ queryKey: key, queryFn: skipToken });
  const outbox = useAppStore((state) => state.prompt[scope]?.outbox ?? EMPTY_OUTBOX);
  const requestState = useRef({ scope, client, connected, online });
  const revisions = useRef(new Map<string, number>());
  const flushing = useRef(false);
  const pendingPromptsBySession = useMemo(() => {
    if (outbox === EMPTY_OUTBOX) return snapshot.prompts;
    const prompts = { ...snapshot.prompts };
    for (const [sessionId, local] of Object.entries(outbox.bySession)) {
      prompts[sessionId] = mergePrompts(prompts[sessionId] ?? [], local);
    }
    return prompts;
  }, [outbox, snapshot.prompts]);
  const pendingNoticesBySession = snapshot.notices;
  const queueSize = Object.values(outbox.bySession).reduce((size, entries) => size + entries.filter((entry) => entry.queued).length, 0);

  useLayoutEffect(() => { requestState.current = { scope, client, connected, online }; });
  const isCurrent = useCallback(() => requestState.current.client === client && requestState.current.scope === scope && isCurrentClient(client), [client, isCurrentClient, scope]);
  const readOutbox = useCallback(() => store.getState().prompt[scope]?.outbox ?? EMPTY_OUTBOX, [scope, store]);
  const changeOutbox = useCallback((change: (current: PromptOutbox) => PromptOutbox) => {
    store.getState().setPrompt(scope, (current) => ({ outbox: change(current.outbox ?? EMPTY_OUTBOX) }));
  }, [scope, store]);
  const changeLocal = useCallback((sessionId: string, change: (previous: PromptOutbox['bySession'][string]) => PromptOutbox['bySession'][string]) => {
    if (readOutbox().bySession[sessionId]) changeOutbox((current) => ({ ...current, bySession: { ...current.bySession, [sessionId]: change(current.bySession[sessionId]) } }));
  }, [changeOutbox, readOutbox]);
  const enqueue = useCallback((prompt: PendingPrompt, input: PromptInput) => {
    if (!readOutbox().bySession[prompt.sessionId]?.some((entry) => entry.prompt.id === prompt.id)) return;
    changeOutbox((current) => {
      const sequence = current.sequence + 1;
      const entries = current.bySession[prompt.sessionId];
      return { sequence, bySession: { ...current.bySession, [prompt.sessionId]: entries.map((entry) => entry.prompt.id === prompt.id
        ? { prompt: { ...prompt, state: 'queued' }, queued: { input, sequence } } : entry) } };
    });
  }, [changeOutbox, readOutbox]);
  const bumpRevision = useCallback((sessionId: string) => {
    const revision = (revisions.current.get(sessionId) ?? 0) + 1;
    revisions.current.set(sessionId, revision);
    return revision;
  }, []);

  const recordAdmission = useCallback((sessionId: string, id: string, admitted: PendingPrompt) => {
    if (isCurrent()) {
      bumpRevision(sessionId);
      cache.setQueryData<PromptSnapshot>(key, (current = EMPTY_SNAPSHOT) => ({
        ...current,
        prompts: { ...current.prompts, [sessionId]: [...(current.prompts[sessionId] ?? []).filter((item) => item.id !== admitted.id), admitted] },
      }));
    }
    changeLocal(sessionId, (previous) => previous.filter((entry) => entry.prompt.id !== id));
  }, [bumpRevision, cache, changeLocal, isCurrent, key]);

  const refreshMessages = useCallback(async (sessionId: string, silent = false, options?: TranscriptReadOptions) => {
    if (!client.promptInbox) return readMessages(sessionId, silent, options);
    // A targeted assistant reconcile does not change the pending stack. Skipping
    // the inbox read also avoids re-downloading a queued prompt's attachments.
    if (options?.messageId && !options.delivered) return readMessages(sessionId, silent, options);
    const revision = bumpRevision(sessionId);
    // Read the inbox first: a delivery committed between reads will already be
    // in the following transcript snapshot. Failed inbox reads retain the stack.
    const [pending, notices] = await Promise.all([
      getSessionInbox(client, sessionId).catch(() => undefined),
      getSessionNotices(client, sessionId).catch(() => undefined),
    ]);
    // Inbox transitions only need the pending stack. Reading the transcript for
    // them would re-download the newly delivered prompt and its attachments.
    const records = options?.inboxOnly ? [] : await readMessages(sessionId, silent, options);
    if (!isCurrent()) return records;
    if (options?.delivered && pending) {
      // A delivered prompt becomes a transcript record from its pending data;
      // the stored message (and its inline attachment bytes) is never fetched.
      const pendingIds = new Set(pending.map((prompt) => prompt.id));
      const server = cache.getQueryData<PromptSnapshot>(key)?.prompts[sessionId] ?? [];
      const previous = mergePrompts(server, readOutbox().bySession[sessionId] ?? []);
      const candidates = previous.filter((prompt) => (prompt.state === 'sending' || prompt.state === 'waiting') && !pendingIds.has(prompt.id));
      const deliveredPrompt = options.inboxID
        ? previous.find((prompt) => prompt.id === options.inboxID) ?? candidates[0]
        : candidates[0];
      if (deliveredPrompt) {
        appendUserMessage?.(sessionId, {
          id: options.inboxID ?? deliveredPrompt.id,
          createdAt: deliveredPrompt.createdAt,
          text: deliveredPrompt.text,
          attachments: deliveredPrompt.attachments.map((attachment) => ({ url: attachment.uri, mime: attachment.mime, filename: attachment.filename })),
        });
      }
    }
    if (revisions.current.get(sessionId) === revision && (pending || notices)) {
      const delivered = new Set(records.map((record) => record.info.id));
      cache.setQueryData<PromptSnapshot>(key, (current = EMPTY_SNAPSHOT) => ({
        prompts: pending ? { ...current.prompts, [sessionId]: pending.filter((prompt) => !delivered.has(prompt.id)).sort((a, b) => a.createdAt - b.createdAt) } : current.prompts,
        notices: notices ? { ...current.notices, [sessionId]: notices.filter((notice) => !delivered.has(notice.id)) } : current.notices,
      }));
    }
    return records;
  }, [appendUserMessage, bumpRevision, cache, client, isCurrent, key, readMessages, readOutbox]);

  const submitPrompt = useCallback(async (input: PromptInput, delivery: PromptDelivery) => {
    if (!client.promptInbox) {
      await submitLegacyPrompt(client, input);
      return;
    }
    if (!isCurrent()) return;
    const sessionId = input.sessionID;
    const sequence = readOutbox().sequence + 1;
    const id = `sending-${sequence}`;
    const offline = !requestState.current.online;
    const prompt: PendingPrompt = {
      id, sessionId, createdAt: Date.now(), delivery, state: offline ? 'queued' : 'sending', text: promptText(input),
      attachments: (input.parts ?? []).filter((part) => part.type === 'file').map((part) => ({ uri: part.url, mime: part.mime, filename: part.filename })),
    };
    changeOutbox((current) => ({
      sequence,
      bySession: { ...current.bySession, [sessionId]: [...(current.bySession[sessionId] ?? []), { prompt, queued: offline ? { input, sequence } : undefined }] },
    }));
    if (offline) return;
    try {
      const admitted = await client.promptInbox.submit(input, delivery);
      recordAdmission(sessionId, id, admitted);
      return admitted;
    } catch (error) {
      if (canQueueAfterFailure(error)) {
        enqueue(prompt, input);
        return;
      }
      if (!(error instanceof PromptPreparationError) && isUncertainDelivery(error)) {
        changeLocal(sessionId, (previous) => previous.map((entry) => entry.prompt.id === id ? { prompt: { ...prompt, state: 'uncertain' } } : entry));
        return;
      }
      changeLocal(sessionId, (previous) => previous.filter((entry) => entry.prompt.id !== id));
      throw error;
    }
  }, [changeLocal, changeOutbox, client, enqueue, isCurrent, readOutbox, recordAdmission]);

  const flushQueued = useCallback(async () => {
    if (flushing.current || !client.promptInbox || !connected || !online) return;
    const entries = Object.values(readOutbox().bySession).flat()
      .flatMap(({ prompt, queued }) => queued && prompt.state === 'queued' ? [{ prompt, sequence: queued.sequence }] : [])
      .sort((a, b) => a.sequence - b.sequence);
    if (entries.length === 0) return;
    flushing.current = true;
    try {
      for (const { prompt } of entries) {
        if (!requestState.current.connected || !requestState.current.online || !isCurrent()) return;
        const { id, sessionId, delivery } = prompt;
        const input = readOutbox().bySession[sessionId]?.find((entry) => entry.prompt.id === id && entry.prompt.state === 'queued')?.queued?.input;
        if (!input) continue;
        changeLocal(sessionId, (previous) => previous.map((entry) => entry.prompt.id === id ? { ...entry, prompt: { ...prompt, state: 'sending' } } : entry));
        try {
          const admitted = await client.promptInbox.submit(input, delivery);
          recordAdmission(sessionId, id, admitted);
        } catch (error) {
          if (canQueueAfterFailure(error)) {
            enqueue(prompt, input);
            return;
          }
          changeLocal(sessionId, (previous) => previous.map((entry) => entry.prompt.id === id ? { prompt: { ...prompt, state: 'uncertain' } } : entry));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [changeLocal, client, connected, enqueue, isCurrent, online, readOutbox, recordAdmission]);

  useEffect(() => {
    if (!connected || !online || queueSize === 0) return;
    // Keep trying while a queued prompt exists. A NetInfo transition is the
    // fast path; this timer also covers platforms where reachability lags
    // behind the actual radio.
    void flushQueued();
    const timer = setInterval(() => { void flushQueued(); }, 3000);
    return () => clearInterval(timer);
  }, [connected, flushQueued, online, queueSize]);

  const cancelPrompt = useCallback(async (sessionId: string, promptId: string) => {
    if (!isCurrent()) return;
    const local = readOutbox().bySession[sessionId]?.find(({ prompt }) => prompt.id === promptId);
    if (local) {
      if (local.prompt.state !== 'sending') changeLocal(sessionId, (previous) => previous.filter(({ prompt }) => prompt.id !== promptId));
      return;
    }
    if (!client.promptInbox) {
      throw new Error('Prompt cancellation is unavailable.');
    }
    await client.promptInbox.cancel(sessionId, promptId);
    if (!isCurrent()) return;
    bumpRevision(sessionId);
    cache.setQueryData<PromptSnapshot>(key, (current = EMPTY_SNAPSHOT) => ({
      ...current,
      prompts: { ...current.prompts, [sessionId]: (current.prompts[sessionId] ?? []).filter((prompt) => prompt.id !== promptId) },
    }));
  }, [bumpRevision, cache, changeLocal, client, isCurrent, key, readOutbox]);

  return { pendingPromptsBySession, pendingNoticesBySession, refreshMessages, submitPrompt, cancelPrompt, flushQueuedPrompts: flushQueued };
}
