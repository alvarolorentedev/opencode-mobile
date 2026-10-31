import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { stopWorkingSoundAsync } from '@/shared/platform/voice/working-sound';
import { createWakePhraseSession } from '@/shared/platform/voice/wake-phrase';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';
import type { ConversationInputPhase } from '@/features/voice/model/types';

// Starts either the on-device detector or the system phrase gate and owns the
// fresh-arm/preserve rules. Kept separate so the main state machine stays below
// the file-size ratchet.
export function useConversationArming({
  abortSpeechInput,
  clearPendingConversationResult,
  conversationCancelRequestedRef,
  conversationListeningRestartTimeoutRef,
  conversationPhaseRef,
  conversationSessionId,
  conversationSubmittingRef,
  conversationWakePhrase,
  localWakeModeActiveRef,
  onSensorChange,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  setPendingConversationTurn,
  setQueuedConversationPrompt,
  startLocalCommandRef,
  startLocalWakeRef,
  startSpeechInput,
  voiceWakeMode,
  wakePhraseRequired,
  wakePhraseSessionRef,
}: {
  abortSpeechInput: () => void;
  clearPendingConversationResult: () => void;
  conversationCancelRequestedRef: { current: boolean };
  conversationListeningRestartTimeoutRef: { current: ReturnType<typeof setTimeout> | undefined };
  conversationPhaseRef: { current: ConversationInputPhase };
  conversationSessionId?: string;
  conversationSubmittingRef: { current: boolean };
  conversationWakePhrase: string;
  localWakeModeActiveRef: { current: boolean };
  onSensorChange: (sensor: 'phrase' | 'local') => void;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<import('@/shared/platform/voice/speech-errors').VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  setPendingConversationTurn: Dispatch<SetStateAction<string | undefined>>;
  setQueuedConversationPrompt: Dispatch<SetStateAction<string | undefined>>;
  startLocalCommandRef: { current: () => Promise<boolean> };
  startLocalWakeRef: { current: () => Promise<boolean> };
  startSpeechInput: (options?: { continuous?: boolean }) => Promise<boolean>;
  voiceWakeMode: 'phrase' | 'local';
  wakePhraseRequired: boolean;
  wakePhraseSessionRef: { current: ReturnType<typeof createWakePhraseSession> };
}) {
  return useCallback(async (sessionId?: string, options?: { preserveSession?: boolean }) => {
    const preserve = Boolean(options?.preserveSession);
    if (!sessionId && !conversationSessionId) {
      return false;
    }

    if (!preserve) {
      clearPendingConversationResult();
      wakePhraseSessionRef.current = createWakePhraseSession(conversationWakePhrase);
      setConversationLatestHeardText(undefined);
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = false;
    conversationSubmittingRef.current = false;
    if (!preserve) {
      setPendingConversationTurn(undefined);
      setQueuedConversationPrompt(undefined);
    }
    await stopWorkingSoundAsync().catch(() => undefined);

    if (conversationCancelRequestedRef.current) {
      return false;
    }

    if (!preserve) {
      // Set the logical phase before starting so a result emitted immediately
      // after the native start is routed correctly instead of being dropped as
      // stale output. Without a wake phrase, every recognized utterance is a
      // command and confirmation is the submission gate.
      conversationPhaseRef.current = wakePhraseRequired ? 'armed' : 'listening';
      setConversationPhase(wakePhraseRequired ? 'armed' : 'listening');
      if (!wakePhraseRequired) {
        wakePhraseSessionRef.current.reset();
        wakePhraseSessionRef.current.markMatched();
      }
      if (voiceWakeMode === 'local') {
        abortSpeechInput();
        localWakeModeActiveRef.current = true;
        onSensorChange('local');
        const localStarted = wakePhraseRequired
          ? await startLocalWakeRef.current()
          : await startLocalCommandRef.current();
        if (localStarted) {
          return true;
        }
        localWakeModeActiveRef.current = false;
        onSensorChange('phrase');
        applyConversationFeedback(
          setConversationFeedback,
          setConversationFeedbackAction,
          'On-device wake word is unavailable. Install models or enroll your voice, or use the phrase gate.',
        );
      }
    }
    localWakeModeActiveRef.current = false;
    onSensorChange('phrase');
    const started = await startSpeechInput({ continuous: true });
    // The ref can change while the native start resolves (stop, background, or
    // an immediately matched phrase); widen it back to the full union.
    if (conversationCancelRequestedRef.current || conversationPhaseRef.current === 'off') {
      abortSpeechInput();
      return false;
    }
    if (!started) {
      conversationPhaseRef.current = 'off';
      setConversationPhase('off');
      return false;
    }

    return true;
  }, [
    abortSpeechInput,
    clearPendingConversationResult,
    conversationCancelRequestedRef,
    conversationListeningRestartTimeoutRef,
    conversationPhaseRef,
      conversationSessionId,
    conversationSubmittingRef,
    conversationWakePhrase,
    localWakeModeActiveRef,
    onSensorChange,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    startLocalCommandRef,
    startLocalWakeRef,
    startSpeechInput,
    voiceWakeMode,
    wakePhraseRequired,
    wakePhraseSessionRef,
  ]);
}
