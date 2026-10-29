import { useCallback, useLayoutEffect, useRef } from 'react';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { ConversationReadbackEntry } from '@/providers/opencode-provider-types';
import { getConversationAssistantEntries as collectConversationAssistantEntries } from '@/providers/conversation/assistant-entries';

export function useConversationAssistantEntries(messagesBySession: Record<string, SessionMessageRecord[]>) {
  const getConversationAssistantEntries = useCallback(
    (sessionId?: string): ConversationReadbackEntry[] => collectConversationAssistantEntries(messagesBySession, sessionId),
    [messagesBySession],
  );
  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => getConversationAssistantEntries(sessionId).at(-1)?.entry,
    [getConversationAssistantEntries],
  );
  const latestAssistantRef = useRef(getLatestConversationAssistantEntry);
  useLayoutEffect(() => { latestAssistantRef.current = getLatestConversationAssistantEntry; }, [getLatestConversationAssistantEntry]);
  return { getConversationAssistantEntries, getLatestConversationAssistantEntry, latestAssistantRef };
}
