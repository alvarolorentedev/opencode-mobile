import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';

import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { CONVERSATION_LISTENING_RESTART_MS, type ConversationPhase } from '@/providers/opencode-provider-types';
import { applyConversationFeedback } from '@/providers/conversation/feedback';

export function useConversationListeningEffects({
  conversationPhase,
  isConversationListening,
  isConversationListeningStarting,
  conversationPhaseRef,
  conversationCancelRequestedRef,
  conversationSubmittingRef,
  conversationListeningRestartTimeoutRef,
  startConversationListening,
  abortSpeechInput,
  speechInputError,
  speechInputErrorAction,
  speechInputErrorCode,
  stopConversationMode,
  setConversationFeedback,
  setConversationFeedbackAction,
}: {
  conversationPhase: ConversationPhase;
  isConversationListening: boolean;
  isConversationListeningStarting: boolean;
  conversationPhaseRef: { current: ConversationPhase };
  conversationCancelRequestedRef: { current: boolean };
  conversationSubmittingRef: { current: boolean };
  conversationListeningRestartTimeoutRef: { current: ReturnType<typeof setTimeout> | undefined };
  startConversationListening: (sessionId?: string) => Promise<boolean | void>;
  abortSpeechInput: () => void;
  speechInputError?: string;
  speechInputErrorAction: VoiceRecoveryAction;
  speechInputErrorCode?: string;
  stopConversationMode: () => Promise<void>;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
}) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        if (conversationPhaseRef.current === 'off') abortSpeechInput();
        else void stopConversationMode();
      }
    });
    return () => {
      subscription.remove();
      abortSpeechInput();
    };
  }, [abortSpeechInput, conversationPhaseRef, stopConversationMode]);

  useEffect(() => {
    if (conversationPhase !== 'listening' || isConversationListening || isConversationListeningStarting) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }

    if (conversationCancelRequestedRef.current || conversationSubmittingRef.current) {
      return;
    }

    conversationListeningRestartTimeoutRef.current = setTimeout(() => {
      conversationListeningRestartTimeoutRef.current = undefined;
      if (
        conversationPhaseRef.current !== 'listening' ||
        conversationCancelRequestedRef.current ||
        conversationSubmittingRef.current
      ) {
        return;
      }

      void startConversationListening();
    }, CONVERSATION_LISTENING_RESTART_MS);

    return () => {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
    };
  }, [conversationCancelRequestedRef, conversationListeningRestartTimeoutRef, conversationPhase, conversationPhaseRef, conversationSubmittingRef, isConversationListening, isConversationListeningStarting, startConversationListening]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    if (
      conversationPhaseRef.current === 'listening' &&
      (speechInputErrorCode === 'client' || speechInputErrorCode === 'no-speech' || speechInputErrorCode === 'speech-timeout')
    ) {
      return;
    }

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      speechInputError,
      speechInputErrorAction,
    );
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [conversationPhaseRef, setConversationFeedback, setConversationFeedbackAction, speechInputError, speechInputErrorAction, speechInputErrorCode, stopConversationMode]);
}
