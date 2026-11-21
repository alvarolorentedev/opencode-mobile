import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/shared/utilities/error-message';
import { classifyConnectionFailure } from '@/shared/protocol/opencode/client/errors';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { PromptPreparationError, type PendingNotice, type PendingPrompt, type PromptDelivery, type PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import type { TranscriptReadOptions } from '@/shared/contracts/domain';
import { getSessionInbox, getSessionNotices, submitLegacyPrompt } from '@/shared/protocol/services/session-service';

const EMPTY_PROMPTS: Record<string, PendingPrompt[]> = {};
const EMPTY_NOTICES: Record<string, PendingNotice[]> = {};

type QueuedInput = { input: PromptInput; delivery: PromptDelivery; scope: string };
type PromptSnapshot = { prompts: Record<string, PendingPrompt[]>; notices: Record<string, PendingNotice[]> };
const EMPTY_SNAPSHOT: PromptSnapshot = { prompts: EMPTY_PROMPTS, notices: EMPTY_NOTICES };

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
  const [snapshots, setSnapshots] = useState<Map<string, PromptSnapshot>>(() => new Map());
  const snapshot = snapshots.get(scope) ?? EMPTY_SNAPSHOT;
  const [queueSize, setQueueSize] = useState(0);
  const snapshotsRef = useRef(snapshots);
  const snapshotRef = useRef(snapshot);
  const activeQueueScope = useRef(scope);
  const reachability = useRef({ connected, online });
  const revisions = useRef<Record<string, number>>({});
  const counter = useRef(0);
  const queuedInputs = useRef(new Map<string, QueuedInput>());
  const flushing = useRef(false);
  const pendingPromptsBySession = snapshot.prompts;
  const pendingNoticesBySession = snapshot.notices;

  useLayoutEffect(() => {
    snapshotsRef.current = snapshots;
    snapshotRef.current = snapshot;
    activeQueueScope.current = scope;
    reachability.current = { connected, online };
  });
  const syncQueueSize = useCallback(() => {
    setQueueSize([...queuedInputs.current.values()].filter((item) => item.scope === activeQueueScope.current).length);
  }, []);
  useEffect(() => {
    syncQueueSize();
  }, [scope, syncQueueSize]);

  // Keep the latest snapshot readable synchronously: a prompt delivery can
  // arrive before the render that would otherwise publish the optimistic send.
  const publish = useCallback((next: Map<string, PromptSnapshot>) => {
    snapshotsRef.current = next;
    snapshotRef.current = next.get(scope) ?? EMPTY_SNAPSHOT;
    setSnapshots(next);
  }, [scope]);

  const update = useCallback((sessionId: string, change: (previous: PendingPrompt[]) => PendingPrompt[]) => {
    if (!isCurrentClient(client)) return;
    const current = snapshotsRef.current;
    const branch = current.get(scope) ?? EMPTY_SNAPSHOT;
    const next = new Map(current);
    next.set(scope, { ...branch, prompts: { ...branch.prompts, [sessionId]: change(branch.prompts[sessionId] ?? []) } });
    publish(next);
  }, [client, isCurrentClient, publish, scope]);

  const updateNotices = useCallback((sessionId: string, notices: PendingNotice[]) => {
    if (!isCurrentClient(client)) return;
    const current = snapshotsRef.current;
    const branch = current.get(scope) ?? EMPTY_SNAPSHOT;
    const previous = branch.notices[sessionId] ?? [];
    if (previous.length === notices.length && previous.every((notice, index) => notice.id === notices[index].id)) return;
    const next = new Map(current);
    next.set(scope, { ...branch, notices: { ...branch.notices, [sessionId]: notices } });
    publish(next);
  }, [client, isCurrentClient, publish, scope]);

  const refreshMessages = useCallback(async (sessionId: string, silent = false, options?: TranscriptReadOptions) => {
    if (!client.promptInbox) return readMessages(sessionId, silent, options);
    // A targeted assistant reconcile does not change the pending stack. Skipping
    // the inbox read also avoids re-downloading a queued prompt's attachments.
    if (options?.messageId && !options.delivered) return readMessages(sessionId, silent, options);
    const revision = (revisions.current[sessionId] ?? 0) + 1;
    revisions.current[sessionId] = revision;
    // Read the inbox first: a delivery committed between reads will already be
    // in the following transcript snapshot. Failed inbox reads retain the stack.
    const [pending, notices] = await Promise.all([
      getSessionInbox(client, sessionId).catch(() => undefined),
      getSessionNotices(client, sessionId).catch(() => undefined),
    ]);
    // Inbox transitions only need the pending stack. Reading the transcript for
    // them would re-download the newly delivered prompt and its attachments.
    const records = options?.inboxOnly ? [] : await readMessages(sessionId, silent, options);
    if (options?.delivered && pending) {
      // A delivered prompt becomes a transcript record from its pending data;
      // the stored message (and its inline attachment bytes) is never fetched.
      const pendingIds = new Set(pending.map((prompt) => prompt.id));
      const local = snapshotRef.current.prompts[sessionId] ?? [];
      const candidates = local.filter((prompt) => (prompt.state === 'sending' || prompt.state === 'waiting') && !pendingIds.has(prompt.id));
      const deliveredPrompt = options.inboxID
        ? local.find((prompt) => prompt.id === options.inboxID) ?? candidates[0]
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
    if (revisions.current[sessionId] === revision) {
      const delivered = new Set(records.map((record) => record.info.id));
      if (pending) {
        update(sessionId, (previous) => [
          ...previous.filter((prompt) => prompt.state === 'sending' || prompt.state === 'queued' || prompt.state === 'uncertain'),
          ...pending.filter((prompt) => !delivered.has(prompt.id)),
        ].sort((a, b) => a.createdAt - b.createdAt));
      }
      if (notices) updateNotices(sessionId, notices.filter((notice) => !delivered.has(notice.id)));
    }
    return records;
  }, [appendUserMessage, client, readMessages, update, updateNotices]);

  const submitPrompt = useCallback(async (input: PromptInput, delivery: PromptDelivery) => {
    if (!client.promptInbox) {
      await submitLegacyPrompt(client, input);
      return;
    }
    const sessionId = input.sessionID;
    const id = `sending-${++counter.current}`;
    const text = promptText(input);
    const prompt: PendingPrompt = {
      id, sessionId, createdAt: Date.now(), delivery, state: 'sending', text,
      attachments: (input.parts ?? []).filter((part) => part.type === 'file').map((part) => ({ uri: part.url, mime: part.mime, filename: part.filename })),
    };
    const enqueue = () => {
      queuedInputs.current.set(id, { input, delivery, scope });
      syncQueueSize();
      update(sessionId, (previous) => [...previous.filter((item) => item.id !== id), { ...prompt, state: 'queued' }]);
      return undefined;
    };
    if (!reachability.current.online) return enqueue();
    update(sessionId, (previous) => [...previous, prompt]);
    try {
      const admitted = await client.promptInbox.submit(input, delivery);
      revisions.current[sessionId] = (revisions.current[sessionId] ?? 0) + 1;
      update(sessionId, (previous) => [...previous.filter((item) => item.id !== id && item.id !== admitted.id), admitted]);
      return admitted;
    } catch (error) {
      if (canQueueAfterFailure(error)) return enqueue();
      if (!(error instanceof PromptPreparationError) && isUncertainDelivery(error)) {
        update(sessionId, (previous) => previous.map((item) => item.id === id ? { ...item, state: 'uncertain' } : item));
        return;
      }
      update(sessionId, (previous) => previous.filter((item) => item.id !== id));
      throw error;
    }
  }, [client, scope, syncQueueSize, update]);

  const flushQueued = useCallback(async () => {
    if (flushing.current || !client.promptInbox || !connected || !online) return;
    const entries = [...queuedInputs.current.entries()].filter(([, item]) => item.scope === scope);
    if (entries.length === 0) return;
    flushing.current = true;
    try {
      for (const [id, item] of entries) {
        if (!reachability.current.connected || !reachability.current.online || activeQueueScope.current !== scope || !isCurrentClient(client)) return;
        if (!queuedInputs.current.delete(id)) continue;
        const sessionId = item.input.sessionID;
        update(sessionId, (previous) => previous.map((entry) => entry.id === id ? { ...entry, state: 'sending' } : entry));
        try {
          const admitted = await client.promptInbox.submit(item.input, item.delivery);
          revisions.current[sessionId] = (revisions.current[sessionId] ?? 0) + 1;
          update(sessionId, (previous) => [...previous.filter((entry) => entry.id !== id && entry.id !== admitted.id), admitted]);
        } catch (error) {
          if (canQueueAfterFailure(error)) {
            queuedInputs.current.set(id, item);
            update(sessionId, (previous) => previous.map((entry) => entry.id === id ? { ...entry, state: 'queued' } : entry));
            return;
          }
          update(sessionId, (previous) => previous.map((entry) => entry.id === id ? { ...entry, state: 'uncertain' } : entry));
        } finally {
          syncQueueSize();
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [client, connected, isCurrentClient, online, scope, syncQueueSize, update]);

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
    if (local?.state === 'sending') return;
    if (local?.state === 'queued' || local?.state === 'uncertain') {
      if (local.state === 'queued' && !queuedInputs.current.delete(promptId)) return;
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
  }, [client, isCurrentClient, syncQueueSize, update]);

  return { pendingPromptsBySession, pendingNoticesBySession, refreshMessages, submitPrompt, cancelPrompt, flushQueuedPrompts: flushQueued };
}
