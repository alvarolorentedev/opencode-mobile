import { useMemo } from 'react';

import { useWorkspaceDomainValue } from '@/runtime/core';

import { useVoiceTest } from './state/use-voice-setup-test';

export function useConversation() {
  const value = useWorkspaceDomainValue((values) => values.conversationValue, 'useConversation');
  const runConversation = useVoiceTest()?.runConversation;
  return useMemo(() => runConversation ? {
    ...value, toggleConversationMode: () => runConversation(value.toggleConversationMode),
  } : value, [runConversation, value]);
}
