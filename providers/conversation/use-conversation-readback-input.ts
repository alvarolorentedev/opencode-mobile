import { useCallback } from 'react';

import type {
  ConversationInputPhase,
  ConversationReadbackPhase,
} from '@/providers/opencode-provider-types';

// Owns the handoff between the microphone and TTS readback. Input stays
// logically armed; only the native detector is paused while reading.
export function useConversationReadbackInput({
  abortSpeechInput,
  conversationInputPhaseRef,
  conversationReadbackPhaseRef,
  conversationSessionId,
  startConversationListening,
  stopLocalWakeRef,
}: {
  abortSpeechInput: () => void;
  conversationInputPhaseRef: { current: ConversationInputPhase };
  conversationReadbackPhaseRef: { current: ConversationReadbackPhase };
  conversationSessionId?: string;
  startConversationListening: (sessionId?: string, options?: { preserveSession?: boolean }) => Promise<boolean | void>;
  stopLocalWakeRef: { current: () => Promise<void> };
}) {
  const pauseInput = useCallback(async () => {
    abortSpeechInput();
    await stopLocalWakeRef.current().catch(() => undefined);
    // Give the native recorder/recognizer a beat to release the audio session
    // before TTS claims it.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }, [abortSpeechInput, stopLocalWakeRef]);

  const resumeInput = useCallback(() => {
    const phase = conversationInputPhaseRef.current;
    if (phase === 'off' || phase === 'confirming' || phase === 'submitting') {
      return;
    }
    void startConversationListening(conversationSessionId).catch(() => undefined);
  }, [conversationInputPhaseRef, conversationSessionId, startConversationListening]);

  const canRead = useCallback(
    () => conversationInputPhaseRef.current !== 'off' && conversationReadbackPhaseRef.current === 'speaking',
    [conversationInputPhaseRef, conversationReadbackPhaseRef],
  );

  return { canRead, pauseInput, resumeInput };
}
