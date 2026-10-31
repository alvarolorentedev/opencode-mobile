import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { ChatContextValue } from '@/features/chat/model/types';

export const ChatContext = createContext<ChatContextValue | null>(null);

export const useChat = () => useDomainValue(ChatContext, 'useChat');
