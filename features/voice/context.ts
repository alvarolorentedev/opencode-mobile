import { useWorkspaceDomainValue } from '@/runtime/core';

export const useConversation = () => useWorkspaceDomainValue((values) => values.conversationValue, 'useConversation');
