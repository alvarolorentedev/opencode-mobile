import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/lib/error-message';
import { classifyConnectionFailure } from '@/lib/opencode/client/errors';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { PendingPrompt, PromptDelivery, PromptInput } from '@/lib/opencode/prompt-inbox';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';
import { getSessionInbox } from '@/providers/services/session-service';

const EMPTY_PROMPTS: Record<string, PendingPrompt[]> = {};

type QueuedInput = { input: PromptInput; delivery: PromptDelivery; text: string; createdAt: number };

function promptText(input: PromptInput) {
  return (input.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
}

function isQueueableTransportFailure(error: unknown, online: boolean) {
  if (!online) return true;
  const kind = classifyConnectionFailure(error);
  if (kind === 'offline' || kind === 'timeout' || kind === 'tunnel-startup') return true;
  // A validation/HTTP 4xx error is not a delivery uncertainty. Only a
  // transport-shaped failure can have reached the server without a response.
  const status = (error as { status?: number; cause?: { status?: number } } | undefined)?.status
    ?? (error as { cause?: { status?: number } } | undefined)?.cause?.status;
  // A definite HTTP response means the server answered. Treat it as a normal
  // failure (restore the draft / surface the error), never as an uncertain
  // delivery that might be replayed.
  if (status !== undefined) return false;
  // Some native transports only report a generic fetch failure.
  return /fetch failed|failed to fetch|network request failed|network unavailable|timed? ?out|connection (?:closed|reset|failed)/i.test(
    getErrorMessage(error),
  );
}

function isOfflineLikeFailure(error: unknown, online: boolean) {
  if (!online) return true;
  if (classifyConnectionFailure(error) === 'offline') return true;
  return /failed to fetch|fetch failed|network request failed|network unavailable|not connected to the internet|\boffline\b/i.test(
    getErrorMessage(error),
  );
}

function messageHasPrompt(records: SessionMessageRecord[], text: string) {
  if (!text.trim()) return false;
  return records.some((record) => record.info.role === 'user'
    && record.parts.some((part) => part.type === 'text' && part.text.includes(text.trim())));
}

export function usePromptInbox({
  client,
  isCurrentClient,
  refreshMessages: readMessages,
  connected = true,
  online = true,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
  connected?: boolean;
  online?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<{ client: object; prompts: Record<string, PendingPrompt[]> }>({ client, prompts: {} });
  const [queueSize, setQueueSize] = useState(0);
  const snapshotRef = useRef(snapshot);
  const revisions = useRef<Record<string, number>>({});
  const counter = useRef(0);
  const queuedInputs = useRef(new Map<string, QueuedInput>());
  const flushing = useRef(false);
  const pendingPromptsBySession = snapshot.client === client ? snapshot.prompts : EMPTY_PROMPTS;

  useLayoutEffect(() => { snapshotRef.current = snapshot; });
  const syncQueueSize = useCallback(() => setQueueSize(queuedInputs.current.size), []);
  useEffect(() => {
    // A connection/client switch is a different server identity. Never replay a
    // prompt prepared for the previous connection.
    queuedInputs.current.clear();
    const reset = setTimeout(() => setQueueSize(0), 0);
    return () => clearTimeout(reset);
  }, [client]);

  const update = useCallback((sessionId: string, change: (previous: PendingPrompt[]) => PendingPrompt[]) => {
    if (!isCurrentClient(client)) return;
    setSnapshot((current) => {
      const prompts = current.client === client ? current.prompts : {};
      return { client, prompts: { ...prompts, [sessionId]: change(prompts[sessionId] ?? []) } };
    });
  }, [client, isCurrentClient]);

  const reconcileLocal = useCallback((sessionId: string, pending: PendingPrompt[] | undefined, records: SessionMessageRecord[]) => {
    update(sessionId, (previous) => previous.flatMap((prompt) => {
      if (prompt.state !== 'queued' && prompt.state !== 'uncertain') return [prompt];
      const transcriptMatch = messageHasPrompt(records, prompt.text);
      const inboxMatch = pending?.find((item) => item.text.trim() === prompt.text.trim());
      if (!transcriptMatch && !inboxMatch) return [prompt];
      queuedInputs.current.delete(prompt.id);
      syncQueueSize();
      return inboxMatch && !transcriptMatch ? [inboxMatch] : [];
    }));
  }, [syncQueueSize, update]);

  const refreshMessages = useCallback(async (sessionId: string, silent = false, options?: { mode?: TranscriptRefreshMode }) => {
    if (!client.promptInbox) return readMessages(sessionId, silent, options);
    const revision = (revisions.current[sessionId] ?? 0) + 1;
    revisions.current[sessionId] = revision;
    // Read the inbox first: a delivery committed between reads will already be
    // in the following transcript snapshot. Failed inbox reads retain the stack.
    const pending = await getSessionInbox(client, sessionId).catch(() => undefined);
    const records = await readMessages(sessionId, silent, options);
    if (pending && revisions.current[sessionId] === revision) {
      const delivered = new Set(records.map((record) => record.info.id));
      update(sessionId, (previous) => [
        ...previous.filter((prompt) => prompt.state === 'sending' || prompt.state === 'queued' || prompt.state === 'uncertain'),
        ...pending.filter((prompt) => !delivered.has(prompt.id)),
      ].sort((a, b) => a.createdAt - b.createdAt));
      reconcileLocal(sessionId, pending, records);
    }
    return records;
  }, [client, readMessages, reconcileLocal, update]);

  const submitPrompt = useCallback(async (input: PromptInput, delivery: PromptDelivery) => {
    if (!client.promptInbox) {
      if (!client.compatibility) throw new Error('Prompt admission is unavailable.');
      await client.compatibility.session.promptAsync(input);
      return;
    }
    const sessionId = input.sessionID;
    const id = `sending-${++counter.current}`;
    const text = promptText(input);
    const prompt: PendingPrompt = {
      id, sessionId, createdAt: Date.now(), delivery, state: 'sending', text,
      attachments: (input.parts ?? []).filter((part) => part.type === 'file').map((part) => ({ uri: part.url, mime: part.mime, filename: part.filename })),
    };
    update(sessionId, (previous) => [...previous, prompt]);
    try {
      const admitted = await client.promptInbox.submit(input, delivery);
      revisions.current[sessionId] = (revisions.current[sessionId] ?? 0) + 1;
      queuedInputs.current.delete(id);
      syncQueueSize();
      update(sessionId, (previous) => [...previous.filter((item) => item.id !== id && item.id !== admitted.id), admitted]);
    } catch (error) {
      if (isQueueableTransportFailure(error, online)) {
        // Keep the prompt visible and retry it when connectivity returns. The
        // flush reconciles the inbox/transcript first, so a request that did
        // reach the server is not replayed as a duplicate.
        const queued = isOfflineLikeFailure(error, online);
        if (queued) {
          queuedInputs.current.set(id, { input, delivery, text, createdAt: prompt.createdAt });
          syncQueueSize();
        }
        update(sessionId, (previous) => previous.map((item) => item.id === id
          ? { ...item, state: queued ? 'queued' : 'uncertain' }
          : item));
        if (!queued) {
          // A timeout is an uncertain mutation. Surface the condition but do
          // not throw: the composer should clear while the prompt remains
          // visible for reconciliation or explicit dismissal.
          return;
        }
        return;
      }
      update(sessionId, (previous) => previous.filter((item) => item.id !== id));
      throw error;
    }
  }, [client, online, syncQueueSize, update]);

  const flushQueued = useCallback(async () => {
    if (flushing.current || !client.promptInbox || !connected || !online) return;
    const entries = [...queuedInputs.current.entries()].filter(([, item]) => item);
    if (entries.length === 0) return;
    flushing.current = true;
    try {
      for (const [id, item] of entries) {
        if (!isCurrentClient(client)) return;
        const sessionId = item.input.sessionID;
        const pending = await getSessionInbox(client, sessionId).catch(() => undefined);
        if (!pending) continue;
        const records = await readMessages(sessionId, true).catch(() => undefined);
        if (!records) continue;
        const inboxMatch = pending.find((entry) => entry.text.trim() === item.text.trim());
        if (inboxMatch) {
          queuedInputs.current.delete(id);
          syncQueueSize();
          update(sessionId, (previous) => [...previous.filter((entry) => entry.id !== id && entry.id !== inboxMatch.id), inboxMatch]);
          continue;
        }
        if (messageHasPrompt(records, item.text)) {
          queuedInputs.current.delete(id);
          syncQueueSize();
          update(sessionId, (previous) => previous.filter((entry) => entry.id !== id));
          continue;
        }
        try {
          const admitted = await client.promptInbox.submit(item.input, item.delivery);
          queuedInputs.current.delete(id);
          syncQueueSize();
          update(sessionId, (previous) => [...previous.filter((entry) => entry.id !== id && entry.id !== admitted.id), admitted]);
        } catch (error) {
          if (isQueueableTransportFailure(error, online)) {
            if (!isOfflineLikeFailure(error, online)) {
              queuedInputs.current.delete(id);
              syncQueueSize();
              update(sessionId, (previous) => previous.map((entry) => entry.id === id ? { ...entry, state: 'uncertain' } : entry));
            }
            continue;
          }
          // A server-side rejection must not stay silently queued forever.
          queuedInputs.current.delete(id);
          syncQueueSize();
          update(sessionId, (previous) => previous.map((entry) => entry.id === id ? { ...entry, state: 'uncertain' } : entry));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [client, connected, isCurrentClient, online, readMessages, syncQueueSize, update]);

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
    const local = snapshotRef.current.prompts[sessionId]?.find((prompt) => prompt.id === promptId);
    if (local?.state === 'queued' || local?.state === 'uncertain') {
      queuedInputs.current.delete(promptId);
      syncQueueSize();
      update(sessionId, (previous) => previous.filter((prompt) => prompt.id !== promptId));
      return;
    }
    if (!client.promptInbox) {
      throw new Error('Prompt cancellation is unavailable.');
    }
    await client.promptInbox.cancel(sessionId, promptId);
    if (!isCurrentClient(client)) return;
    update(sessionId, (previous) => previous.filter((prompt) => prompt.id !== promptId));
  }, [client, isCurrentClient, update]);

  return { pendingPromptsBySession, refreshMessages, submitPrompt, cancelPrompt, flushQueuedPrompts: flushQueued };
}
