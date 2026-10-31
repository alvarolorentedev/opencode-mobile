import type { ConversationPhase } from '@/features/voice/model/types';

export function getConversationStatusLabel(conversationPhase: ConversationPhase, conversationCurrentActivityLabel?: string) {
  switch (conversationPhase) {
    case 'armed':
      return 'Waiting for phrase';
    case 'listening':
      return 'Listening';
    case 'confirming':
      return 'Confirm command';
    case 'submitting':
      return 'Sending';
    case 'waiting':
      return conversationCurrentActivityLabel || 'Thinking';
    case 'speaking':
      return 'Speaking';
    default:
      return undefined;
  }
}
