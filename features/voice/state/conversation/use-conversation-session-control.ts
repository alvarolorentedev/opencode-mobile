import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { TranscriptEntry } from '@/shared/presentation/format';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import { stopWorkingSoundAsync } from '@/shared/platform/voice/working-sound';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import type { ConnectionState } from '@/shared/contracts/domain';
import type { ConversationInputPhase, ConversationReadbackPhase } from '@/features/voice/model/types';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';

// Owns the existing start/stop/arming lifecycle. Confirmation is cancelled
// through a callback so this hook does not need to know its internals.
export function useConversationSessionControl({
  abortSpeechInput,
  assistantReplyBaselineIdRef,
  cancelConfirmation,
  clearPendingConversationResult,
  connectionStatus,
  conversationCancelRequestedRef,
  conversationListeningRestartTimeoutRef,
  conversationPhase,
  conversationPhaseRef,
  conversationSessionId,
  conversationStartingRef,
  conversationSubmittingRef,
  currentSessionId,
  ensureActiveSession,
  getLatestConversationAssistantEntry,
  localWakeModeActiveRef,
  pendingPermissionsBySession,
  pendingQuestionsBySession,
  sendingStateActive,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  setConversationSessionId,
  setConversationWakeSensor,
  setCurrentSessionId,
  setPendingConversationTurn,
  setQueuedConversationPrompt,
  setReadbackPhase,
  startConversationListening,
  stopLocalWakeRef,
  stopSpeaking,
}: {
  abortSpeechInput: () => void;
  assistantReplyBaselineIdRef: { current: string | undefined };
  cancelConfirmation: () => void;
  clearPendingConversationResult: () => void;
  connectionStatus: ConnectionState['status'];
  conversationCancelRequestedRef: { current: boolean };
  conversationListeningRestartTimeoutRef: { current: ReturnType<typeof setTimeout> | undefined };
  conversationPhase: ConversationInputPhase;
  conversationPhaseRef: { current: ConversationInputPhase };
  conversationSessionId?: string;
  conversationStartingRef: { current: boolean };
  conversationSubmittingRef: { current: boolean };
  currentSessionId?: string;
  ensureActiveSession: () => Promise<string | undefined>;
  getLatestConversationAssistantEntry: (sessionId?: string) => TranscriptEntry | undefined;
  localWakeModeActiveRef: { current: boolean };
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  sendingStateActive: boolean;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  setConversationSessionId: Dispatch<SetStateAction<string | undefined>>;
  setConversationWakeSensor: Dispatch<SetStateAction<'phrase' | 'local'>>;
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setPendingConversationTurn: Dispatch<SetStateAction<string | undefined>>;
  setQueuedConversationPrompt: Dispatch<SetStateAction<string | undefined>>;
  setReadbackPhase: (phase: ConversationReadbackPhase) => void;
  startConversationListening: (sessionId?: string, options?: { preserveSession?: boolean }) => Promise<boolean | void>;
  stopLocalWakeRef: { current: () => Promise<void> };
  stopSpeaking: () => Promise<void>;
}) {
  const stopConversationMode = useCallback(async () => {
    cancelConfirmation();
    clearPendingConversationResult();
    localWakeModeActiveRef.current = false;
    await stopLocalWakeRef.current().catch(() => undefined);
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    conversationSubmittingRef.current = false;
    conversationPhaseRef.current = 'off';
    setReadbackPhase('idle');
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationLatestHeardText(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
    setConversationWakeSensor('phrase');
  }, [
    abortSpeechInput,
    cancelConfirmation,
    clearPendingConversationResult,
    conversationCancelRequestedRef,
    conversationListeningRestartTimeoutRef,
    conversationPhaseRef,
    conversationSubmittingRef,
    localWakeModeActiveRef,
    setConversationLatestHeardText,
    setConversationPhase,
    setConversationSessionId,
    setConversationWakeSensor,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    setReadbackPhase,
    stopLocalWakeRef,
    stopSpeaking,
  ]);

  const toggleConversationMode = useCallback(async () => {
    if (conversationStartingRef.current) return;
    if (conversationPhase !== 'off') {
      await stopConversationMode();
      return;
    }

    if (connectionStatus !== 'connected') {
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Connect to OpenCode before starting conversation mode.',
      );
      return;
    }

    if (sendingStateActive) {
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Wait for the current reply to finish before starting conversation mode.',
      );
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length
        + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Answer the current request before starting conversation mode.',
      );
      return;
    }

    conversationStartingRef.current = true;
    try {
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) return;

      abortSpeechInput();
      await stopSpeaking().catch(() => undefined);
      await stopWorkingSoundAsync().catch(() => undefined);
      setCurrentSessionId(sessionId);
      setConversationSessionId(sessionId);
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
      setPendingConversationTurn(undefined);
      setQueuedConversationPrompt(undefined);
      setReadbackPhase('idle');
      assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(sessionId)?.id;
      const started = await startConversationListening(sessionId);
      if (!started) setConversationSessionId(undefined);
    } finally {
      conversationStartingRef.current = false;
    }
  }, [
    abortSpeechInput,
    assistantReplyBaselineIdRef,
    connectionStatus,
    conversationPhase,
    conversationStartingRef,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingStateActive,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationSessionId,
    setCurrentSessionId,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    setReadbackPhase,
    startConversationListening,
    stopConversationMode,
    stopSpeaking,
  ]);

  return { stopConversationMode, toggleConversationMode, conversationSessionId };
}
