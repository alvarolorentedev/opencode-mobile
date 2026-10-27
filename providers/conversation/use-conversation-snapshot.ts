import { useMemo } from 'react';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { getConversationStatusLabel, getTranscript, getTranscriptActivityLabelForEntries } from '@/providers/opencode-provider-selectors';
import type {
  ConversationInputPhase,
  ConversationPhase,
  ConversationReadbackPhase,
  ConversationState,
} from '@/providers/opencode-provider-types';

// Derives the memoized conversation snapshot from provider state. Input and
// readback are independent; `phase` remains the combined label consumed by
// surfaces that have not moved to the split fields yet.
export function useConversationSnapshot({
  conversationFeedback,
  conversationFeedbackAction,
  conversationLatestHeardText,
  conversationListeningLevel,
  conversationInputPhase,
  conversationReadbackPhase,
  conversationSessionId,
  messagesBySession,
  wakePhrase,
}: {
  conversationFeedback?: string;
  conversationFeedbackAction?: VoiceRecoveryAction;
  conversationLatestHeardText?: string;
  conversationListeningLevel: number;
  conversationInputPhase: ConversationInputPhase;
  conversationReadbackPhase: ConversationReadbackPhase;
  conversationSessionId?: string;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  wakePhrase: string;
}): ConversationState {
  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => getTranscript(conversationMessages), [conversationMessages]);
  const conversationCurrentActivityLabel = useMemo(() => getTranscriptActivityLabelForEntries(conversationTranscript), [conversationTranscript]);
  const conversationActive = conversationInputPhase !== 'off';
  const conversationPhase: ConversationPhase = conversationInputPhase === 'listening' || conversationInputPhase === 'submitting'
    ? conversationInputPhase
    : conversationReadbackPhase === 'speaking'
      ? 'speaking'
      : conversationReadbackPhase === 'waiting'
        ? 'waiting'
        : conversationInputPhase;
  const conversationStatusLabel = useMemo(
    () => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel),
    [conversationCurrentActivityLabel, conversationPhase],
  );

  return useMemo<ConversationState>(
    () => ({
      active: conversationActive,
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
    }),
    [
      conversationActive,
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
    ],
  );
}
