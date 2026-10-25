import { useMemo } from 'react';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { getConversationStatusLabel, getTranscript, getTranscriptActivityLabelForEntries } from '@/providers/opencode-provider-selectors';
import type { ConversationPhase, ConversationState } from '@/providers/opencode-provider-types';

// Derives the memoized conversation snapshot from provider state. Kept out of
// the orchestration hook so the state machine stays within the file-size
// ratchet and the snapshot has one owner.
export function useConversationSnapshot({
  conversationFeedback,
  conversationFeedbackAction,
  conversationLatestHeardText,
  conversationListeningLevel,
  conversationPhase,
  conversationSessionId,
  messagesBySession,
  wakePhrase,
}: {
  conversationFeedback?: string;
  conversationFeedbackAction?: VoiceRecoveryAction;
  conversationLatestHeardText?: string;
  conversationListeningLevel: number;
  conversationPhase: ConversationPhase;
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
  const conversationActive = conversationPhase !== 'off';
  const conversationStatusLabel = useMemo(
    () => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel),
    [conversationCurrentActivityLabel, conversationPhase],
  );

  return useMemo<ConversationState>(
    () => ({
      active: conversationActive,
      feedback: conversationFeedback,
      feedbackAction: conversationFeedbackAction,
      isListening: conversationPhase === 'listening',
      level: conversationListeningLevel,
      latestHeardText: conversationLatestHeardText,
      phase: conversationPhase,
      sessionId: conversationSessionId,
      statusLabel: conversationStatusLabel,
      wakePhrase,
    }),
    [
      conversationActive,
      conversationFeedback,
      conversationFeedbackAction,
      conversationLatestHeardText,
      conversationListeningLevel,
      conversationPhase,
      conversationSessionId,
      conversationStatusLabel,
      wakePhrase,
    ],
  );
}
