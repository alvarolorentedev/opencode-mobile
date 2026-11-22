import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAppStore } from '@/runtime/core';

import { EMPTY_OUTBOX, EMPTY_SNAPSHOT, mergePromptOutbox, type PromptInboxBinding, type PromptSnapshot } from '../services/prompt-inbox-commands';
import { promptInboxKey } from '../services/queries';

export function usePromptInboxSnapshot(identity: PromptInboxBinding['identity'], client: PromptInboxBinding['client'], queueScope: string) {
  const { data: snapshot = EMPTY_SNAPSHOT } = useQuery<PromptSnapshot>({ queryKey: promptInboxKey(identity, client), queryFn: skipToken });
  const outbox = useAppStore((state) => state.prompt[queueScope]?.outbox ?? EMPTY_OUTBOX);
  const pendingPromptsBySession = useMemo(() => mergePromptOutbox(snapshot.prompts, outbox), [outbox, snapshot.prompts]);

  return { pendingPromptsBySession, pendingNoticesBySession: snapshot.notices };
}
