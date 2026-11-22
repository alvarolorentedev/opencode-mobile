import { skipToken, useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';

import { EMPTY_OUTBOX, EMPTY_SNAPSHOT, mergePrompts, type createPromptInboxCommands, type PromptInboxBinding, type PromptSnapshot } from '../services/prompt-inbox-commands';
import { promptInboxKey } from '../services/queries';

type InboxActions = ReturnType<ReturnType<typeof createPromptInboxCommands>['actions']>;

export function usePromptInbox({
  client, identity, queueScope, isCurrentClient, refreshMessages: readMessages, appendUserMessage, connected = true, online = true,
}: Omit<PromptInboxBinding, 'readMessages' | 'scope'> & {
  queueScope: string;
  refreshMessages: PromptInboxBinding['readMessages'];
  connected?: boolean;
  online?: boolean;
}) {
  const { commands } = useAppCore();
  const [inbox] = useState(() => commands.prompt.createInbox());
  const binding = useMemo<PromptInboxBinding>(() => ({
    client, identity, scope: queueScope, isCurrentClient, readMessages, appendUserMessage,
  }), [appendUserMessage, client, identity, isCurrentClient, queueScope, readMessages]);

  useLayoutEffect(() => inbox.dispose, [inbox]);
  useLayoutEffect(() => { inbox.configure({ ...binding, connected, online }); }, [binding, connected, inbox, online]);
  const refreshMessages = useCallback<InboxActions['refreshMessages']>((...args) => inbox.actions(binding).refreshMessages(...args), [binding, inbox]);
  const submitPrompt = useCallback<InboxActions['submitPrompt']>((...args) => inbox.actions(binding).submitPrompt(...args), [binding, inbox]);
  const cancelPrompt = useCallback<InboxActions['cancelPrompt']>((...args) => inbox.actions(binding).cancelPrompt(...args), [binding, inbox]);
  const flushQueuedPrompts = useCallback(() => inbox.actions(binding).flushQueuedPrompts(), [binding, inbox]);

  const { data: snapshot = EMPTY_SNAPSHOT } = useQuery<PromptSnapshot>({ queryKey: promptInboxKey(binding.identity, client), queryFn: skipToken });
  const outbox = useAppStore((state) => state.prompt[queueScope]?.outbox ?? EMPTY_OUTBOX);
  const pendingPromptsBySession = useMemo(() => {
    if (outbox === EMPTY_OUTBOX) return snapshot.prompts;
    const prompts = { ...snapshot.prompts };
    for (const [sessionId, local] of Object.entries(outbox.bySession)) {
      prompts[sessionId] = mergePrompts(prompts[sessionId] ?? [], local);
    }
    return prompts;
  }, [outbox, snapshot.prompts]);

  return { pendingPromptsBySession, pendingNoticesBySession: snapshot.notices, refreshMessages, submitPrompt, cancelPrompt, flushQueuedPrompts };
}
