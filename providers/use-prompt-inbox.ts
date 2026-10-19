import { useCallback, useRef, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { PendingPrompt, PromptDelivery, PromptInput } from '@/lib/opencode/prompt-inbox';
import type { TranscriptRefreshMode } from '@/providers/opencode-provider-types';
import { getSessionInbox } from '@/providers/services/session-service';

export function usePromptInbox({ client, isCurrentClient, refreshMessages: readMessages }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
}) {
  const [snapshot, setSnapshot] = useState<{ client: object; prompts: Record<string, PendingPrompt[]> }>({ client, prompts: {} });
  const revisions = useRef<Record<string, number>>({});
  const counter = useRef(0);
  const pendingPromptsBySession = snapshot.client === client ? snapshot.prompts : {};

  const update = useCallback((sessionId: string, change: (previous: PendingPrompt[]) => PendingPrompt[]) => {
    if (!isCurrentClient(client)) return;
    setSnapshot((current) => {
      const prompts = current.client === client ? current.prompts : {};
      return { client, prompts: { ...prompts, [sessionId]: change(prompts[sessionId] ?? []) } };
    });
  }, [client, isCurrentClient]);

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
        ...previous.filter((prompt) => prompt.state === 'sending'),
        ...pending.filter((prompt) => !delivered.has(prompt.id)),
      ].sort((a, b) => a.createdAt - b.createdAt));
    }
    return records;
  }, [client, readMessages, update]);

  const submitPrompt = useCallback(async (input: PromptInput, delivery: PromptDelivery) => {
    if (!client.promptInbox) {
      if (!client.compatibility) throw new Error('Prompt admission is unavailable.');
      await client.compatibility.session.promptAsync(input);
      return;
    }
    const sessionId = input.sessionID;
    const id = `sending-${++counter.current}`;
    const prompt: PendingPrompt = {
      id, sessionId, createdAt: Date.now(), delivery, state: 'sending',
      text: (input.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n\n'),
      attachments: (input.parts ?? []).filter((part) => part.type === 'file').map((part) => ({ uri: part.url, mime: part.mime, filename: part.filename })),
    };
    update(sessionId, (previous) => [...previous, prompt]);
    try {
      const admitted = await client.promptInbox.submit(input, delivery);
      revisions.current[sessionId] = (revisions.current[sessionId] ?? 0) + 1;
      update(sessionId, (previous) => [...previous.filter((item) => item.id !== id && item.id !== admitted.id), admitted]);
    } catch (error) {
      update(sessionId, (previous) => previous.filter((item) => item.id !== id));
      throw error;
    }
  }, [client, update]);

  const cancelPrompt = useCallback(async (sessionId: string, promptId: string) => {
    if (!client.promptInbox) {
      throw new Error('Prompt cancellation is unavailable.');
    }
    await client.promptInbox.cancel(sessionId, promptId);
    if (!isCurrentClient(client)) return;
    update(sessionId, (previous) => previous.filter((prompt) => prompt.id !== promptId));
  }, [client, isCurrentClient, update]);

  return { pendingPromptsBySession, refreshMessages, submitPrompt, cancelPrompt };
}
