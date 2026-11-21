import { useWorkspaceDomainValue } from '@/runtime/core';

export const useChat = () => useWorkspaceDomainValue((values) => values.chatValue, 'useChat');
