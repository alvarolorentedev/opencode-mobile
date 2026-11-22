import { useCallback } from 'react';

import type { ConversationInputPhase, ConversationReadbackPhase } from '@/features/voice/model/types';

// Owns the handoff between the microphone and TTS readback. Input stays
// logically armed; only the native detector is paused while reading.
export function useConversationReadbackInput({
  abortSpeechInput,
  getConversationPhase,
  getReadbackPhase,
  conversationSessionId,
  startConversationListening,
  stopLocalWakeRef,
}: {
  abortSpeechInput: () => void;
  getConversationPhase: () => ConversationInputPhase;
  getReadbackPhase: () => ConversationReadbackPhase;
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
    const phase = getConversationPhase();
    if (phase === 'off' || phase === 'confirming' || phase === 'submitting') {
      return;
    }
    void startConversationListening(conversationSessionId).catch(() => undefined);
  }, [getConversationPhase, conversationSessionId, startConversationListening]);

  const canRead = useCallback(
    () => getConversationPhase() !== 'off' && getReadbackPhase() === 'speaking',
    [getConversationPhase, getReadbackPhase],
  );

  return { canRead, pauseInput, resumeInput };
}
