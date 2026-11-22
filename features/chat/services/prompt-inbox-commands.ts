import type { QueryClient } from '@tanstack/react-query';

import type { PromptOutbox } from '@/runtime/core';
import type { TranscriptReadOptions } from '@/shared/contracts/transcript-read';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { classifyConnectionFailure } from '@/shared/protocol/opencode/client/errors';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { PromptPreparationError, type PendingNotice, type PendingPrompt, type PromptDelivery, type PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import { getSessionInbox, getSessionNotices, submitLegacyPrompt } from '@/shared/protocol/services/session-service';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { getErrorMessage } from '@/shared/utilities/error-message';

import { promptInboxKey } from './queries';

const EMPTY_PROMPTS: Record<string, PendingPrompt[]> = {};
const EMPTY_NOTICES: Record<string, PendingNotice[]> = {};

export type PromptSnapshot = { prompts: Record<string, PendingPrompt[]>; notices: Record<string, PendingNotice[]> };
export const EMPTY_SNAPSHOT: PromptSnapshot = { prompts: EMPTY_PROMPTS, notices: EMPTY_NOTICES };
export const EMPTY_OUTBOX: PromptOutbox = { sequence: 0, bySession: {} };

export function readPendingPromptSessionIds(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, outbox?: PromptOutbox) {
  const { prompts } = cache.getQueryData<PromptSnapshot>(promptInboxKey(identity, client)) ?? EMPTY_SNAPSHOT;
  return [...new Set([...Object.keys(prompts).filter((id) => prompts[id].length),
    ...Object.keys(outbox?.bySession ?? {}).filter((id) => outbox?.bySession[id].length)])];
}

export function mergePromptOutbox(prompts: PromptSnapshot['prompts'], outbox: PromptOutbox) {
  if (outbox === EMPTY_OUTBOX) return prompts;
  const next = { ...prompts };
  for (const [sessionId, local] of Object.entries(outbox.bySession)) {
    next[sessionId] = mergePrompts(prompts[sessionId] ?? [], local);
  }
  return next;
}

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

type ReadMessages = (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;

export type PromptInboxBinding = {
  client: ScopedOpencodeClient;
  identity: QueryIdentity;
  scope: string;
  isCurrentClient: (candidate: object) => boolean;
  readMessages: ReadMessages;
  appendUserMessage?: (sessionId: string, input: {
    id: string; createdAt: number; text: string;
    attachments: { url: string; mime?: string; filename?: string }[];
  }) => void;
};

type PromptInboxInput = PromptInboxBinding & { connected: boolean; online: boolean };

export function createPromptInboxCommands({ cache, clock, readOutbox: read, writeOutbox, subscribe }: {
  cache: QueryClient;
  clock: () => number;
  readOutbox: (scope: string) => PromptOutbox | undefined;
  writeOutbox: (scope: string, change: (current: PromptOutbox) => PromptOutbox) => void;
  subscribe: (scope: string, listener: () => void) => () => void;
}) {
  let current: PromptInboxInput | undefined;
  let stopListening: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushing = false;
  const revisions = new Map<string, number>();

  function actions(binding: PromptInboxBinding) {
    const { client, identity, scope, isCurrentClient, readMessages, appendUserMessage } = binding;
    const key = promptInboxKey(identity, client);
    const isCurrent = () => current?.client === client && current.scope === scope
      && current.identity.connectionId === identity.connectionId && current.identity.authRevision === identity.authRevision
      && current.identity.connectionScope === identity.connectionScope
      && isCurrentClient(client);
    const readOutbox = () => read(scope) ?? EMPTY_OUTBOX;
    const changeOutbox = (change: (prev: PromptOutbox) => PromptOutbox) => writeOutbox(scope, change);
    function changeLocal(sessionId: string, change: (previous: PromptOutbox['bySession'][string]) => PromptOutbox['bySession'][string]) {
      if (!readOutbox().bySession[sessionId]) return;
      changeOutbox((outbox) => ({ ...outbox, bySession: { ...outbox.bySession, [sessionId]: change(outbox.bySession[sessionId]) } }));
    }
    function enqueue(prompt: PendingPrompt, input: PromptInput) {
      if (!readOutbox().bySession[prompt.sessionId]?.some((entry) => entry.prompt.id === prompt.id)) return;
      changeOutbox((outbox) => {
        const sequence = outbox.sequence + 1;
        const entries = outbox.bySession[prompt.sessionId];
        return { sequence, bySession: { ...outbox.bySession, [prompt.sessionId]: entries.map((entry) => entry.prompt.id === prompt.id
          ? { prompt: { ...prompt, state: 'queued' }, queued: { input, sequence } } : entry) } };
      });
    }
    function bumpRevision(sessionId: string) {
      const revision = (revisions.get(sessionId) ?? 0) + 1;
      revisions.set(sessionId, revision);
      return revision;
    }

    function recordAdmission(sessionId: string, id: string, admitted: PendingPrompt) {
      if (isCurrent()) {
        bumpRevision(sessionId);
        cache.setQueryData<PromptSnapshot>(key, (current = EMPTY_SNAPSHOT) => ({
          ...current,
          prompts: { ...current.prompts, [sessionId]: [...(current.prompts[sessionId] ?? []).filter((item) => item.id !== admitted.id), admitted] },
        }));
      }
      changeLocal(sessionId, (previous) => previous.filter((entry) => entry.prompt.id !== id));
    }

    async function refreshMessages(sessionId: string, silent = false, options?: TranscriptReadOptions) {
      if (!isCurrent()) return [];
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
      if (options?.delivered && pending && !pending.some((prompt) => prompt.id === options.inboxID)) {
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
      if (revisions.get(sessionId) === revision && (pending || notices)) {
        const delivered = new Set(records.map((record) => record.info.id));
        cache.setQueryData<PromptSnapshot>(key, (current = EMPTY_SNAPSHOT) => ({
          prompts: pending ? { ...current.prompts, [sessionId]: pending.filter((prompt) => !delivered.has(prompt.id)).sort((a, b) => a.createdAt - b.createdAt) } : current.prompts,
          notices: notices ? { ...current.notices, [sessionId]: notices.filter((notice) => !delivered.has(notice.id)) } : current.notices,
        }));
      }
      return records;
    }

    async function submitPrompt(input: PromptInput, delivery: PromptDelivery) {
      if (!isCurrent()) return;
      if (!client.promptInbox) {
        await submitLegacyPrompt(client, input);
        return;
      }
      const sessionId = input.sessionID;
      const sequence = readOutbox().sequence + 1;
      const id = `sending-${sequence}`;
      const offline = !current?.online;
      const prompt: PendingPrompt = {
        id, sessionId, createdAt: clock(), delivery, state: offline ? 'queued' : 'sending', text: promptText(input),
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
    }

    async function flushQueued() {
      if (flushing || !client.promptInbox || !current?.connected || !current.online || !isCurrent()) return;
      const entries = Object.values(readOutbox().bySession).flat()
        .flatMap(({ prompt, queued }) => queued && prompt.state === 'queued' ? [{ prompt, sequence: queued.sequence }] : [])
        .sort((a, b) => a.sequence - b.sequence);
      if (entries.length === 0) return;
      flushing = true;
      try {
        for (const { prompt } of entries) {
          if (!current?.connected || !current?.online || !isCurrent()) return;
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
        flushing = false;
      }
    }

    async function cancelPrompt(sessionId: string, promptId: string) {
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
    }
    return { refreshMessages, submitPrompt, cancelPrompt, flushQueuedPrompts: flushQueued };
  }

  function flush() {
    if (current) void actions(current).flushQueuedPrompts();
  }

  function updateQueueTimer() {
    const canFlush = current?.connected && current.online && current.client.promptInbox
      && Object.values(read(current.scope)?.bySession ?? {}).some((entries) => entries.some(({ prompt, queued }) => queued && prompt.state === 'queued'));
    if (!canFlush) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      return;
    }
    if (timer !== undefined) return;
    // Reachability changes trigger a flush immediately. The timer covers a
    // native radio whose reported state lags the actual transport.
    timer = setInterval(flush, 3000);
    flush();
  }

  return {
    actions,
    configure(input: PromptInboxInput) {
      const previous = current;
      current = input;
      if (!stopListening || previous?.scope !== input.scope) {
        stopListening?.();
        stopListening = subscribe(input.scope, updateQueueTimer);
      }
      updateQueueTimer();
      if (previous && previous.client !== input.client && timer !== undefined) flush();
    },
    dispose() {
      current = undefined;
      updateQueueTimer();
      stopListening?.();
      stopListening = undefined;
      revisions.clear();
    },
  };
}
