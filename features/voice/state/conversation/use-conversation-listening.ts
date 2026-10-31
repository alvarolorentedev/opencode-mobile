import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';

import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { CONVERSATION_LISTENING_RESTART_MS, type ConversationInputPhase, type ConversationReadbackPhase } from '@/features/voice/model/types';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';

export function useConversationListeningEffects({
  conversationPhase,
  isConversationListening,
  isConversationListeningStarting,
  conversationPhaseRef,
  conversationCancelRequestedRef,
  conversationSubmittingRef,
  conversationListeningRestartTimeoutRef,
  localWakeModeRef,
  readbackPhase,
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
  conversationPhase: ConversationInputPhase;
  isConversationListening: boolean;
  isConversationListeningStarting: boolean;
  conversationPhaseRef: { current: ConversationInputPhase };
  conversationCancelRequestedRef: { current: boolean };
  conversationSubmittingRef: { current: boolean };
  conversationListeningRestartTimeoutRef: { current: ReturnType<typeof setTimeout> | undefined };
  localWakeModeRef: { current: boolean };
  readbackPhase: ConversationReadbackPhase;
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
    // Readback briefly owns the audio session. The logical input stays armed,
    // but the detector restarts only after speaking finishes.
    if (readbackPhase === 'speaking') {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }
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
  }, [conversationCancelRequestedRef, conversationListeningRestartTimeoutRef, conversationPhase, conversationPhaseRef, conversationSubmittingRef, isConversationListening, isConversationListeningStarting, localWakeModeRef, readbackPhase, shouldRestartConversation, startConversationListening]);

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
