import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { ConversationContextValue } from '@/features/voice/model/types';

export const ConversationContext = createContext<ConversationContextValue | null>(null);

export const useConversation = () => useDomainValue(ConversationContext, 'useConversation');
