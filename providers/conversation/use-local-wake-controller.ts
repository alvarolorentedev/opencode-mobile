import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { useLocalCommandCapture } from '@/lib/voice/use-local-command-capture';
import { useLocalWakeWord } from '@/lib/voice/use-local-wake-word';
import type { LocalCommandModelId, LocalWakePhraseId } from '@/lib/voice/local-wake-word/types';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { playWakePhraseCue } from '@/lib/voice/wake-feedback';
import { applyConversationFeedback } from '@/providers/conversation/feedback';
import type { ConversationInputPhase } from '@/providers/opencode-provider-types';

// Owns the opt-in on-device detector, the target-speaker command capture, and
// the transition between them. The command is transcribed locally only after
// each speech turn passes the enrolled-speaker check.
export function useLocalWakeController({
  commandModel,
  commandLanguage,
  conversationPhaseRef,
  localSpeakerThreshold,
  localSpeakerVerification,
  localWakeModeActiveRef,
  localWakePhrase,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  startLocalWakeRef,
  stopLocalWakeRef,
  submitLocalCommand,
}: {
  commandModel: LocalCommandModelId;
  commandLanguage?: string;
  conversationPhaseRef: { current: ConversationInputPhase };
  localSpeakerThreshold: number;
  localSpeakerVerification: boolean;
  localWakeModeActiveRef: { current: boolean };
  localWakePhrase: LocalWakePhraseId;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  startLocalWakeRef: { current: () => Promise<boolean> };
  stopLocalWakeRef: { current: () => Promise<void> };
  submitLocalCommand: (text: string) => void;
}) {
  const startCommandRef = useRef<() => Promise<boolean>>(async () => false);
  const stopCommandRef = useRef<() => Promise<void>>(async () => undefined);

  const rearmWake = useCallback((delayMs = 350) => {
    setTimeout(() => {
      if (localWakeModeActiveRef.current && conversationPhaseRef.current === 'armed') {
        void startLocalWakeRef.current();
      }
    }, delayMs);
  }, [conversationPhaseRef, localWakeModeActiveRef, startLocalWakeRef]);

  const command = useLocalCommandCapture({
    commandModel,
    language: commandLanguage,
    onCommand: (text) => submitLocalCommand(text),
    onError: (message) => {
      if (!localWakeModeActiveRef.current || conversationPhaseRef.current === 'off') {
        return;
      }
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
      void stopCommandRef.current().catch(() => undefined);
      conversationPhaseRef.current = 'armed';
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      rearmWake(500);
    },
    onNoCommand: () => {
      if (!localWakeModeActiveRef.current || conversationPhaseRef.current === 'off') {
        return;
      }
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'I did not catch a command in your voice. Try again.',
      );
      conversationPhaseRef.current = 'armed';
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      rearmWake(300);
    },
    onPartialCommand: (text) => {
      if (conversationPhaseRef.current === 'listening') {
        setConversationLatestHeardText(text);
      }
    },
    phrase: localWakePhrase,
    speakerThreshold: localSpeakerThreshold,
    verifySpeaker: localSpeakerVerification,
  });

  useLayoutEffect(() => {
    startCommandRef.current = command.start;
    stopCommandRef.current = command.stop;
  }, [command.start, command.stop]);

  const handleWake = useCallback(async () => {
    if (!localWakeModeActiveRef.current || conversationPhaseRef.current !== 'armed') {
      return;
    }
    playWakePhraseCue();
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    conversationPhaseRef.current = 'listening';
    setConversationPhase('listening');
    setConversationLatestHeardText(undefined);
    const started = await startCommandRef.current();
    if (!started) {
      conversationPhaseRef.current = 'armed';
      setConversationPhase('armed');
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Could not start on-device command capture. Using the phrase gate instead.',
      );
      void stopCommandRef.current().catch(() => undefined);
      rearmWake(300);
    }
  }, [conversationPhaseRef, localWakeModeActiveRef, rearmWake, setConversationFeedback, setConversationFeedbackAction, setConversationLatestHeardText, setConversationPhase]);

  const localWake = useLocalWakeWord({
    commandModel,
    language: commandLanguage,
    onError: (message) => {
      if (conversationPhaseRef.current === 'off') {
        return;
      }
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
      if (conversationPhaseRef.current === 'listening') {
        void stopCommandRef.current().catch(() => undefined);
        conversationPhaseRef.current = 'armed';
        setConversationPhase('armed');
        setConversationLatestHeardText(undefined);
      }
      if (conversationPhaseRef.current === 'armed') {
        rearmWake(500);
      }
    },
    onRejected: () => {
      if (conversationPhaseRef.current === 'off') {
        return;
      }
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Voice did not match the enrolled voice. Try again.',
      );
      if (conversationPhaseRef.current !== 'armed') {
        return;
      }
      // Normal rejection keeps the wake detector live; this only re-arms if
      // capture was stopped elsewhere in the meantime.
      rearmWake(300);
    },
    onWake: () => { void handleWake(); },
    phrase: localWakePhrase,
    speakerThreshold: localSpeakerThreshold,
    verifySpeaker: localSpeakerVerification,
  });

  const {
    start: startWakeWord,
    stop: stopWakeWord,
  } = localWake;

  const start = useCallback(async () => {
    await stopCommandRef.current().catch(() => undefined);
    localWakeModeActiveRef.current = true;
    const started = await startWakeWord();
    if (!started) {
      localWakeModeActiveRef.current = false;
    }
    return started;
  }, [localWakeModeActiveRef, startWakeWord]);

  const stop = useCallback(async () => {
    localWakeModeActiveRef.current = false;
    await stopCommandRef.current().catch(() => undefined);
    await stopWakeWord().catch(() => undefined);
  }, [localWakeModeActiveRef, stopWakeWord]);

  useLayoutEffect(() => {
    startLocalWakeRef.current = start;
    stopLocalWakeRef.current = stop;
  }, [start, startLocalWakeRef, stop, stopLocalWakeRef]);

  return { startLocalWake: start, stopLocalWake: stop };
}
