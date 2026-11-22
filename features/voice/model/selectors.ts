import type { ConversationInputPhase, ConversationPhase, ConversationReadbackPhase } from '@/features/voice/model/types';

export function getConversationPhase(input: ConversationInputPhase, readback: ConversationReadbackPhase, wakePhraseRequired: boolean): ConversationPhase {
  // Listening without a wake phrase is the idle input state during readback.
  const phase = !wakePhraseRequired && input === 'listening' && readback !== 'idle' ? 'armed' : input;
  if (phase === 'listening' || phase === 'submitting' || phase === 'confirming') return phase;
  return readback === 'idle' ? phase : readback;
}

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
