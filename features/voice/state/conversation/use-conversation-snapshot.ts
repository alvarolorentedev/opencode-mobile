import { useMemo } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { getConversationStatusLabel } from '@/features/voice/model/selectors';
import { getTranscript, getTranscriptActivityLabelForEntries } from '@/shared/presentation/selectors';
import type { ConversationConfirmationState, ConversationInputPhase, ConversationPhase, ConversationReadbackPhase, ConversationState } from '@/features/voice/model/types';

// Derives the memoized conversation snapshot from provider state. Input and
// readback are independent; `phase` remains the combined label consumed by
// surfaces that have not moved to the split fields yet.
export function useConversationSnapshot({
  conversationConfirmation,
  conversationFeedback,
  conversationFeedbackAction,
  conversationLatestHeardText,
  conversationListeningLevel,
  conversationInputPhase,
  conversationReadbackPhase,
  conversationSessionId,
  messagesBySession,
  wakePhrase,
  wakePhraseRequired,
}: {
  conversationConfirmation?: ConversationConfirmationState;
  conversationFeedback?: string;
  conversationFeedbackAction?: VoiceRecoveryAction;
  conversationLatestHeardText?: string;
  conversationListeningLevel: number;
  conversationInputPhase: ConversationInputPhase;
  conversationReadbackPhase: ConversationReadbackPhase;
  conversationSessionId?: string;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  wakePhrase: string;
  wakePhraseRequired: boolean;
}): ConversationState {
  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => getTranscript(conversationMessages), [conversationMessages]);
  const conversationCurrentActivityLabel = useMemo(() => getTranscriptActivityLabelForEntries(conversationTranscript), [conversationTranscript]);
  const conversationActive = conversationInputPhase !== 'off';
  // Without a wake phrase, `listening` is the idle input state. Readback must
  // still surface as waiting/speaking instead of looking like an active turn.
  const phaseInput = !wakePhraseRequired && conversationInputPhase === 'listening' && conversationReadbackPhase !== 'idle'
    ? 'armed'
    : conversationInputPhase;
  const conversationPhase: ConversationPhase = phaseInput === 'listening'
    || phaseInput === 'submitting'
    || phaseInput === 'confirming'
    ? phaseInput
    : conversationReadbackPhase === 'speaking'
      ? 'speaking'
      : conversationReadbackPhase === 'waiting'
        ? 'waiting'
        : phaseInput;
  const conversationStatusLabel = useMemo(
    () => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel),
    [conversationCurrentActivityLabel, conversationPhase],
  );

  return useMemo<ConversationState>(
    () => ({
      active: conversationActive,
      confirmation: conversationConfirmation,
      feedback: conversationFeedback,
      feedbackAction: conversationFeedbackAction,
      inputPhase: conversationInputPhase,
      isListening: conversationInputPhase === 'listening',
      latestHeardText: conversationLatestHeardText,
      level: conversationListeningLevel,
      phase: conversationPhase,
      readbackPhase: conversationReadbackPhase,
      sessionId: conversationSessionId,
      statusLabel: conversationStatusLabel,
      wakePhrase,
      wakePhraseRequired,
    }),
    [
      conversationActive,
      conversationConfirmation,
      conversationFeedback,
      conversationFeedbackAction,
      conversationInputPhase,
      conversationLatestHeardText,
      conversationListeningLevel,
      conversationPhase,
      conversationReadbackPhase,
      conversationSessionId,
      conversationStatusLabel,
      wakePhrase,
      wakePhraseRequired,
    ],
  );
}
