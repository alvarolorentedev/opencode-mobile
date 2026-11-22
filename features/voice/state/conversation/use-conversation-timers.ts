import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import type { createWakePhraseSession } from '@/shared/platform/voice/wake-phrase';
import { CONVERSATION_COMMAND_TIMEOUT_MS, CONVERSATION_FINAL_RESULT_SETTLE_MS, type ConversationInputPhase } from '@/features/voice/model/types';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';

// Owns the two conversation timers: the final-result settle and the bounded
// command window. Keeping them together makes the cancellation rules visible
// and keeps the main state machine below the file-size ratchet.
export function useConversationTimers({
  abortSpeechInputRef,
  getConversationPhase,
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
  getConversationPhase: () => ConversationInputPhase;
  flushPendingConversationResultRef: { current: () => void };
  localWakeModeActiveRef: { current: boolean };
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
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
    if (getConversationPhase() !== 'listening' || !wakePhraseSessionRef.current.command()) {
      return;
    }
    resultTimeoutRef.current = setTimeout(() => {
      resultTimeoutRef.current = undefined;
      flushPendingConversationResultRef.current();
    }, CONVERSATION_FINAL_RESULT_SETTLE_MS);
  }, [clearResultTimeout, getConversationPhase, flushPendingConversationResultRef, wakePhraseSessionRef]);
  const startCommandTimeout = useCallback(() => {
    clearCommandTimeout();
    if (getConversationPhase() !== 'listening') {
      return;
    }
    commandTimeoutRef.current = setTimeout(() => {
      commandTimeoutRef.current = undefined;
      if (getConversationPhase() !== 'listening' || wakePhraseSessionRef.current.command()) {
        return;
      }
      clearPending();
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      if (localWakeModeActiveRef.current) {
        abortSpeechInputRef.current();
        // Let the OS recognizer release the audio session before the local
        // detector re-opens the microphone.
        setTimeout(() => {
          if (localWakeModeActiveRef.current && getConversationPhase() === 'armed') {
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
  }, [abortSpeechInputRef, clearCommandTimeout, clearPending, getConversationPhase, localWakeModeActiveRef, setConversationFeedback, setConversationFeedbackAction, setConversationLatestHeardText, setConversationPhase, startLocalWakeRef, wakePhraseSessionRef]);

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

// Registered at the original cleanup point to preserve microphone/TTS teardown order.
export function useConversationCleanup(restart: { current: ReturnType<typeof setTimeout> | undefined }, stop: () => Promise<void>) {
  useEffect(() => () => {
    if (restart.current) clearTimeout(restart.current);
    void stop().catch(() => undefined);
  }, [restart, stop]);
}
