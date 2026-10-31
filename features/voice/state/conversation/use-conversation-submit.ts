import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { TranscriptEntry } from '@/shared/presentation/format';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import type { ConversationInputPhase, ConversationReadbackPhase } from '@/features/voice/model/types';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';

// Sends one captured turn and immediately re-arms input. Readback is a separate
// state machine; it waits for the settled assistant reply independently.
export function useConversationSubmit({
  assistantReplyBaselineIdRef,
  conversationCancelRequestedRef,
  conversationInputPhase,
  conversationSessionId,
  conversationTurnSequence,
  latestAssistantRef,
  queuedConversationPrompt,
  sendPrompt,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationPhase,
  setPendingConversationTurn,
  setQueuedConversationPrompt,
  setReadbackPhase,
  startConversationListening,
  stopConversationMode,
}: {
  assistantReplyBaselineIdRef: { current: string | undefined };
  conversationCancelRequestedRef: { current: boolean };
  conversationInputPhase: ConversationInputPhase;
  conversationSessionId?: string;
  conversationTurnSequence: number;
  latestAssistantRef: { current: (sessionId?: string) => TranscriptEntry | undefined };
  queuedConversationPrompt?: string;
  sendPrompt: (sessionId: string, prompt: string) => Promise<boolean>;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  setPendingConversationTurn: Dispatch<SetStateAction<string | undefined>>;
  setQueuedConversationPrompt: Dispatch<SetStateAction<string | undefined>>;
  setReadbackPhase: (phase: ConversationReadbackPhase) => void;
  startConversationListening: (sessionId?: string, options?: { preserveSession?: boolean }) => Promise<boolean | void>;
  stopConversationMode: () => Promise<void>;
}) {
  const handledTurnRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (conversationInputPhase !== 'submitting' || !queuedConversationPrompt || !conversationSessionId) {
      return;
    }
    // Confirmation adds voice, touch and edit paths that can re-enter this
    // effect. One turn ID may only ever reach sendPrompt once.
    if (handledTurnRef.current === conversationTurnSequence) {
      return;
    }
    handledTurnRef.current = conversationTurnSequence;

    let cancelled = false;

    const submitPrompt = async () => {
      try {
        // Every accepted command supersedes the previous readback baseline.
        assistantReplyBaselineIdRef.current = latestAssistantRef.current(conversationSessionId)?.id;
        setReadbackPhase('waiting');
        await sendPrompt(conversationSessionId, queuedConversationPrompt);
        if (cancelled) {
          return;
        }

        if (conversationCancelRequestedRef.current) {
          setQueuedConversationPrompt(undefined);
          setPendingConversationTurn(undefined);
          return;
        }

        setQueuedConversationPrompt(undefined);
        setPendingConversationTurn(undefined);
        // Input and readback are independent. Re-arm the next turn immediately
        // so a steer or queued command can arrive while the assistant works.
        setConversationPhase('armed');
        void startConversationListening(conversationSessionId).catch(() => undefined);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Voice conversation failed while sending your message.';
        setQueuedConversationPrompt(undefined);
        setPendingConversationTurn(undefined);
        applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
        await stopConversationMode();
      }
    };

    void submitPrompt();

    return () => {
      cancelled = true;
    };
  }, [
    assistantReplyBaselineIdRef,
    conversationCancelRequestedRef,
    conversationInputPhase,
    conversationSessionId,
    conversationTurnSequence,
    latestAssistantRef,
    queuedConversationPrompt,
    sendPrompt,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationPhase,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    setReadbackPhase,
    startConversationListening,
    stopConversationMode,
  ]);
}
