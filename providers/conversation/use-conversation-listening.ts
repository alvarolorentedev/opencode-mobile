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
  localWakeModeRef,
  shouldRestartConversation,
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
  localWakeModeRef: { current: boolean };
  shouldRestartConversation: () => boolean;
  startConversationListening: (sessionId?: string, options?: { preserveSession?: boolean }) => Promise<boolean | void>;
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
    // The local wake-word hook owns its capture lifecycle and re-arming. Do not
    // start the OS recognizer behind it.
    if (localWakeModeRef.current) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }
    if ((conversationPhase !== 'armed' && conversationPhase !== 'listening') || isConversationListening || isConversationListeningStarting) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }

    if (conversationCancelRequestedRef.current || conversationSubmittingRef.current) {
      return;
    }

    const preserveSession = true;
    conversationListeningRestartTimeoutRef.current = setTimeout(() => {
      conversationListeningRestartTimeoutRef.current = undefined;
      if (
        !shouldRestartConversation() ||
        conversationCancelRequestedRef.current ||
        conversationSubmittingRef.current
      ) {
        return;
      }
      void startConversationListening(undefined, { preserveSession });
    }, CONVERSATION_LISTENING_RESTART_MS);

    return () => {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
    };
  }, [conversationCancelRequestedRef, conversationListeningRestartTimeoutRef, conversationPhase, conversationPhaseRef, conversationSubmittingRef, isConversationListening, isConversationListeningStarting, localWakeModeRef, shouldRestartConversation, startConversationListening]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    if (
      (conversationPhaseRef.current === 'listening' || conversationPhaseRef.current === 'armed') &&
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
