import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { useLocalCommandCapture } from '@/shared/platform/voice/use-local-command-capture';
import { useLocalWakeWord } from '@/shared/platform/voice/use-local-wake-word';
import type { LocalCommandModelId, LocalWakePhraseId } from '@/shared/platform/voice/local-wake-word/types';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { recordWakeDiagnostic } from '@/shared/platform/voice/voice-diagnostics';
import { playWakePhraseCue } from '@/shared/platform/voice/wake-feedback';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';
import type { ConversationInputPhase } from '@/features/voice/model/types';

// Owns the opt-in on-device detector, the target-speaker command capture, and
// the transition between them. The command is transcribed locally only after
// each speech turn passes the enrolled-speaker check.
export function useLocalWakeController({
  commandModel,
  commandLanguage,
  getConversationPhase,
  localSpeakerThreshold,
  localSpeakerVerification,
  localWakeModeActiveRef,
  localWakePhrase,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  startLocalCommandRef,
  startLocalConfirmationRef,
  startLocalWakeRef,
  stopLocalCommandRef,
  stopLocalConfirmationRef,
  stopLocalWakeRef,
  submitLocalCommand,
  onLocalConfirmation,
  onLocalConfirmationEnd,
  onLocalConfirmationError,
  wakePhraseRequired,
}: {
  commandModel: LocalCommandModelId;
  commandLanguage?: string;
  getConversationPhase: () => ConversationInputPhase;
  localSpeakerThreshold: number;
  localSpeakerVerification: boolean;
  localWakeModeActiveRef: { current: boolean };
  localWakePhrase: LocalWakePhraseId;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  startLocalCommandRef: { current: (samples?: Float32Array) => Promise<boolean> };
  startLocalConfirmationRef: { current: () => Promise<boolean> };
  startLocalWakeRef: { current: () => Promise<boolean> };
  stopLocalCommandRef: { current: () => Promise<void> };
  stopLocalConfirmationRef: { current: () => Promise<void> };
  stopLocalWakeRef: { current: () => Promise<void> };
  submitLocalCommand: (text: string) => void;
  onLocalConfirmation: (text: string) => void;
  onLocalConfirmationEnd: () => void;
  onLocalConfirmationError: (message: string) => void;
  wakePhraseRequired: boolean;
}) {
  const startCommandRef = useRef<(samples?: Float32Array) => Promise<boolean>>(async () => false);
  const stopCommandRef = useRef<() => Promise<void>>(async () => undefined);
  const startConfirmationRef = useRef<() => Promise<boolean>>(async () => false);
  const stopConfirmationRef = useRef<() => Promise<void>>(async () => undefined);

  const rearmWake = useCallback((delayMs = 350) => {
    setTimeout(() => {
      if (localWakeModeActiveRef.current && getConversationPhase() === 'armed') {
        void startLocalWakeRef.current();
      }
    }, delayMs);
  }, [getConversationPhase, localWakeModeActiveRef, startLocalWakeRef]);

  const rearmCommand = useCallback((delayMs = 350) => {
    setTimeout(() => {
      if (localWakeModeActiveRef.current && getConversationPhase() === 'listening') {
        void startCommandRef.current();
      }
    }, delayMs);
  }, [getConversationPhase, localWakeModeActiveRef]);

  const command = useLocalCommandCapture({
    commandModel,
    language: commandLanguage,
    onCommand: (text) => submitLocalCommand(text),
    onError: (message) => {
      if (!localWakeModeActiveRef.current || getConversationPhase() === 'off') {
        return;
      }
      if (wakePhraseRequired) recordWakeDiagnostic('local', 'command-capture-failed');
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
      if (!wakePhraseRequired) {
        setConversationPhase('listening');
        setConversationLatestHeardText(undefined);
        void stopCommandRef.current().catch(() => undefined);
        rearmCommand(500);
        return;
      }
      void stopCommandRef.current().catch(() => undefined);
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      rearmWake(500);
    },
    onNoCommand: () => {
      if (!localWakeModeActiveRef.current || getConversationPhase() === 'off') {
        return;
      }
      if (wakePhraseRequired) recordWakeDiagnostic('local', 'command-not-heard');
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'I did not catch a command in your voice. Try again.',
      );
      if (!wakePhraseRequired) {
        setConversationPhase('listening');
        setConversationLatestHeardText(undefined);
        rearmCommand(300);
        return;
      }
      setConversationPhase('armed');
      setConversationLatestHeardText(undefined);
      rearmWake(300);
    },
    onPartialCommand: (text) => {
      if (getConversationPhase() === 'listening') {
        setConversationLatestHeardText(text);
      }
    },
    phrase: localWakePhrase,
    speakerThreshold: localSpeakerThreshold,
    verifySpeaker: localSpeakerVerification,
  });

  // Confirmation is a short, single-turn capture. The wake phrase and the
  // command turn were already speaker-checked, so a sub-second "yes" is not
  // rejected again for having too little embedding audio.
  const confirmation = useLocalCommandCapture({
    commandModel,
    language: commandLanguage,
    onCommand: onLocalConfirmation,
    onError: onLocalConfirmationError,
    onNoCommand: onLocalConfirmationEnd,
    onPartialCommand: () => undefined,
    phrase: localWakePhrase,
    speakerThreshold: localSpeakerThreshold,
    verifySpeaker: false,
    endSilenceMs: 700,
    finishOnFirstTurn: true,
    maxDurationMs: 6000,
    minTurnSamples: Math.round(0.2 * 16000),
    noSpeechMs: 4000,
  });

  useLayoutEffect(() => {
    startCommandRef.current = command.start;
    stopCommandRef.current = command.stop;
    startConfirmationRef.current = confirmation.start;
    stopConfirmationRef.current = confirmation.stop;
  }, [command.start, command.stop, confirmation.start, confirmation.stop]);

  useLayoutEffect(() => {
    startLocalCommandRef.current = command.start;
    stopLocalCommandRef.current = command.stop;
    startLocalConfirmationRef.current = confirmation.start;
    stopLocalConfirmationRef.current = confirmation.stop;
  }, [
    command.start,
    command.stop,
    confirmation.start,
    confirmation.stop,
    startLocalCommandRef,
    startLocalConfirmationRef,
    stopLocalCommandRef,
    stopLocalConfirmationRef,
  ]);

  const handleWake = useCallback(async (initialSamples?: Float32Array) => {
    if (!wakePhraseRequired || !localWakeModeActiveRef.current || getConversationPhase() !== 'armed') {
      return;
    }
    playWakePhraseCue();
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    setConversationPhase('listening');
    setConversationLatestHeardText(undefined);
    const started = await startCommandRef.current(initialSamples);
    if (!started && localWakeModeActiveRef.current && getConversationPhase() === 'listening') {
      recordWakeDiagnostic('local', 'command-start-failed');
      setConversationPhase('armed');
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Could not start on-device command capture. Using the phrase gate instead.',
      );
      void stopCommandRef.current().catch(() => undefined);
      rearmWake(300);
    }
  }, [getConversationPhase, localWakeModeActiveRef, rearmWake, setConversationFeedback, setConversationFeedbackAction, setConversationLatestHeardText, setConversationPhase, wakePhraseRequired]);

  const localWake = useLocalWakeWord({
    commandModel,
    language: commandLanguage,
    onError: (message) => {
      if (getConversationPhase() === 'off') {
        return;
      }
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
      if (getConversationPhase() === 'listening') {
        void stopCommandRef.current().catch(() => undefined);
        void stopConfirmationRef.current().catch(() => undefined);
        setConversationPhase('armed');
        setConversationLatestHeardText(undefined);
      }
      if (getConversationPhase() === 'armed') {
        rearmWake(500);
      }
    },
    onRejected: () => {
      if (getConversationPhase() === 'off') {
        return;
      }
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        'Voice did not match the enrolled voice. Try again.',
      );
      if (getConversationPhase() !== 'armed') {
        return;
      }
      // Normal rejection keeps the wake detector live; this only re-arms if
      // capture was stopped elsewhere in the meantime.
      rearmWake(300);
    },
    onWake: (samples) => { void handleWake(samples); },
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
    await stopConfirmationRef.current().catch(() => undefined);
    localWakeModeActiveRef.current = true;
    const started = await startWakeWord();
    if (!started) {
      localWakeModeActiveRef.current = false;
    }
    return started;
  }, [localWakeModeActiveRef, startWakeWord]);

  const stop = useCallback(async () => {
    localWakeModeActiveRef.current = false;
    await Promise.all([
      stopWakeWord().catch(() => undefined),
      stopCommandRef.current().catch(() => undefined),
      stopConfirmationRef.current().catch(() => undefined),
    ]);
  }, [localWakeModeActiveRef, stopWakeWord]);

  useLayoutEffect(() => {
    startLocalWakeRef.current = start;
    stopLocalWakeRef.current = stop;
  }, [start, startLocalWakeRef, stop, stopLocalWakeRef]);

  return { startLocalWake: start, stopLocalWake: stop };
}
