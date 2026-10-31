import { useCallback, useLayoutEffect, useRef } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ConversationReadbackEntry } from '@/features/voice/model/types';
import { getConversationAssistantEntries as collectConversationAssistantEntries } from '@/features/voice/state/conversation/assistant-entries';

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
