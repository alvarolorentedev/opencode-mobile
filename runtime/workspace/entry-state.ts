import { useChat } from '@/features/chat/context';

export function useSharedInput() { return useChat().sharedInput; }
