import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { createWakePhraseSession } from '@/lib/voice/wake-phrase';
import { CONVERSATION_COMMAND_TIMEOUT_MS, CONVERSATION_FINAL_RESULT_SETTLE_MS, type ConversationPhase } from '@/providers/opencode-provider-types';
import { applyConversationFeedback } from '@/providers/conversation/feedback';

// Owns the two conversation timers: the final-result settle and the bounded
// command window. Keeping them together makes the cancellation rules visible
// and keeps the main state machine below the file-size ratchet.
export function useConversationTimers({
  abortSpeechInputRef,
  conversationPhaseRef,
  flushPendingConversationResultRef,
  localWakeModeActiveRef,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  startLocalWakeRef,
  wakePhraseSessionRef,
}: {
  abortSpeechInputRef: { current: () => void };
  conversationPhaseRef: { current: ConversationPhase };
  flushPendingConversationResultRef: { current: () => void };
  localWakeModeActiveRef: { current: boolean };
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationPhase>>;
  startLocalWakeRef: { current: () => Promise<boolean> };
  wakePhraseSessionRef: { current: ReturnType<typeof createWakePhraseSession> };
}) {
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commandTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearResultTimeout = useCallback(() => {
    if (resultTimeoutRef.current) {
      clearTimeout(resultTimeoutRef.current);
      resultTimeoutRef.current = undefined;
    }
  }, []);
  const clearCommandTimeout = useCallback(() => {
    if (commandTimeoutRef.current) {
      clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = undefined;
    }
  }, []);
  const clearPending = useCallback(() => {
    wakePhraseSessionRef.current.reset();
    clearResultTimeout();
    clearCommandTimeout();
  }, [clearCommandTimeout, clearResultTimeout, wakePhraseSessionRef]);
  const scheduleResult = useCallback(() => {
    clearResultTimeout();
    if (conversationPhaseRef.current !== 'listening' || !wakePhraseSessionRef.current.command()) {
      return;
    }
    resultTimeoutRef.current = setTimeout(() => {
      resultTimeoutRef.current = undefined;
      flushPendingConversationResultRef.current();
    }, CONVERSATION_FINAL_RESULT_SETTLE_MS);
  }, [clearResultTimeout, conversationPhaseRef, flushPendingConversationResultRef, wakePhraseSessionRef]);
  const startCommandTimeout = useCallback(() => {
    clearCommandTimeout();
    if (conversationPhaseRef.current !== 'listening') {
      return;
    }
    commandTimeoutRef.current = setTimeout(() => {
      commandTimeoutRef.current = undefined;
      if (conversationPhaseRef.current !== 'listening' || wakePhraseSessionRef.current.command()) {
        return;
      }
      clearPending();
      conversationPhaseRef.current = 'armed';
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      if (localWakeModeActiveRef.current) {
        abortSpeechInputRef.current();
        // Let the OS recognizer release the audio session before the local
        // detector re-opens the microphone.
        setTimeout(() => {
          if (localWakeModeActiveRef.current && conversationPhaseRef.current === 'armed') {
            void startLocalWakeRef.current();
          }
        }, 250);
      }
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'I did not catch a command. Say the wake phrase and try again.',
      );
    }, CONVERSATION_COMMAND_TIMEOUT_MS);
  }, [abortSpeechInputRef, clearCommandTimeout, clearPending, conversationPhaseRef, localWakeModeActiveRef, setConversationFeedback, setConversationFeedbackAction, setConversationLatestHeardText, setConversationPhase, startLocalWakeRef, wakePhraseSessionRef]);

  useEffect(() => () => {
    clearResultTimeout();
    clearCommandTimeout();
  }, [clearCommandTimeout, clearResultTimeout]);

  return {
    clearCommandTimeout,
    clearPending,
    clearResultTimeout,
    hasCommandTimeout: useCallback(() => Boolean(commandTimeoutRef.current), []),
    scheduleResult,
    startCommandTimeout,
  };
}
