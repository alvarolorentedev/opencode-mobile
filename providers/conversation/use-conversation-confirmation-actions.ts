import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { createWakePhraseSession } from '@/lib/voice/wake-phrase';
import type { ConversationInputPhase } from '@/providers/opencode-provider-types';
import { applyConversationFeedback } from '@/providers/conversation/feedback';

// Retry captures a command again without requiring the wake phrase. Re-arm
// returns to the normal wake state after cancel or timeout.
export function useConversationConfirmationActions({
  clearPendingConversationResult,
  conversationPhaseRef,
  localWakeModeActiveRef,
  rearmConversationListening,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  startConversationCommandTimeout,
  startLocalCommandRef,
  startLocalWakeRef,
  startSpeechInput,
  wakePhraseRequired,
  wakePhraseSessionRef,
}: {
  clearPendingConversationResult: () => void;
  conversationPhaseRef: { current: ConversationInputPhase };
  localWakeModeActiveRef: { current: boolean };
  rearmConversationListening: () => Promise<boolean | void>;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  startConversationCommandTimeout: () => void;
  startLocalCommandRef: { current: () => Promise<boolean> };
  startLocalWakeRef: { current: () => Promise<boolean> };
  startSpeechInput: (options?: { continuous?: boolean }) => Promise<boolean>;
  wakePhraseRequired: boolean;
  wakePhraseSessionRef: { current: ReturnType<typeof createWakePhraseSession> };
}) {
  const retryCommandCapture = useCallback(async () => {
    if (conversationPhaseRef.current === 'off') {
      return false;
    }
    setConversationLatestHeardText(undefined);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    if (localWakeModeActiveRef.current) {
      conversationPhaseRef.current = 'listening';
      setConversationPhase('listening');
      const started = await startLocalCommandRef.current().catch(() => false);
      if (!started) {
        conversationPhaseRef.current = 'armed';
        setConversationPhase('armed');
        applyConversationFeedback(
          setConversationFeedback,
          setConversationFeedbackAction,
          'Could not start on-device command capture. Try again.',
        );
        if (wakePhraseRequired) void startLocalWakeRef.current();
        else void rearmConversationListening();
        return false;
      }
      return true;
    }

    clearPendingConversationResult();
    wakePhraseSessionRef.current.reset();
    wakePhraseSessionRef.current.markMatched();
    conversationPhaseRef.current = 'listening';
    setConversationPhase('listening');
    const started = await startSpeechInput({ continuous: true }).catch(() => false);
    if (!started) {
      conversationPhaseRef.current = 'armed';
      setConversationPhase('armed');
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Could not start command capture. Try again.',
      );
      void rearmConversationListening();
      return false;
    }
    if (wakePhraseRequired) {
      startConversationCommandTimeout();
    }
    return true;
  }, [
    clearPendingConversationResult,
    conversationPhaseRef,
    localWakeModeActiveRef,
    rearmConversationListening,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    startConversationCommandTimeout,
    startLocalCommandRef,
    startLocalWakeRef,
    startSpeechInput,
    wakePhraseRequired,
    wakePhraseSessionRef,
  ]);

  const rearmConversation = useCallback(async () => {
    if (conversationPhaseRef.current === 'off') {
      return;
    }
    setConversationLatestHeardText(undefined);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    await rearmConversationListening();
  }, [
    conversationPhaseRef,
    rearmConversationListening,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
  ]);

  return { rearmConversation, retryCommandCapture };
}
