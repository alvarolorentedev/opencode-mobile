import { requestRecordingPermissionsAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { activateLocalWakeRecordingAsync, deactivateLocalWakeRecordingAsync } from '@/lib/voice/local-wake-word/audio-session';
import { createAudioRingBuffer, createResampler, int16ToFloat32 } from '@/lib/voice/local-wake-word/pcm';
import {
  acceptVadSamples,
  computeLocalSpeakerEmbedding,
  ensureLocalCommandRuntime,
  recognizeLocalCommand,
  resetVad,
} from '@/lib/voice/local-wake-word/runtime';
import { cosineSimilarity } from '@/lib/voice/local-wake-word/similarity';
import { loadLocalSpeakerProfile } from '@/lib/voice/local-wake-word/speaker-profile';
import type { LocalCommandModelId, LocalWakePhraseId } from '@/lib/voice/local-wake-word/types';

const SAMPLE_RATE = 16000;
const PRE_ROLL_SAMPLES = Math.round(0.4 * SAMPLE_RATE);
const MIN_TURN_SAMPLES = Math.round(0.35 * SAMPLE_RATE);
const END_SILENCE_MS = 1200;
const VAD_END_SILENCE_SAMPLES = Math.round(0.4 * SAMPLE_RATE);
const NO_SPEECH_MS = 6000;
const MAX_COMMAND_MS = 15000;
const HANDOFF_SETTLE_MS = 80;
const MAX_HANDOFF_SAMPLES = Math.round(2.5 * SAMPLE_RATE);
// A borderline whole-turn score gets a second look at the first/last half of
// the turn. If the two halves look like different speakers, the turn likely
// contains overlapping voices and is discarded before ASR.
const SPLIT_CONSISTENCY_MIN_SAMPLES = SAMPLE_RATE;
const SPLIT_CONSISTENCY_THRESHOLD = 0.25;
const CONFIDENT_SPEAKER_MARGIN = 0.12;

export type LocalCommandCaptureOptions = {
  commandModel: LocalCommandModelId;
  language?: string;
  phrase: LocalWakePhraseId;
  speakerThreshold: number;
  verifySpeaker: boolean;
  // Confirmation capture uses a shorter single-turn window; command capture
  // keeps the defaults below.
  endSilenceMs?: number;
  finishOnFirstTurn?: boolean;
  maxDurationMs?: number;
  minTurnSamples?: number;
  noSpeechMs?: number;
  onCommand: (text: string) => void;
  onNoCommand: () => void;
  onPartialCommand: (text: string) => void;
  onError: (message: string) => void;
};

// Captures one command window after a verified wake. VAD splits the audio into
// turns, each turn is speaker-checked, and only verified turns are sent to the
// local ASR. Non-matching turns are discarded without transcription.
export function useLocalCommandCapture({
  commandModel,
  language,
  onCommand,
  onError,
  onNoCommand,
  onPartialCommand,
  phrase,
  speakerThreshold,
  verifySpeaker,
  endSilenceMs = END_SILENCE_MS,
  finishOnFirstTurn = false,
  maxDurationMs = MAX_COMMAND_MS,
  minTurnSamples = MIN_TURN_SAMPLES,
  noSpeechMs = NO_SPEECH_MS,
}: LocalCommandCaptureOptions) {
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const startPromiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const finishingRef = useRef(false);
  const turnActiveRef = useRef(false);
  const turnChunksRef = useRef<Float32Array[]>([]);
  const silenceSamplesRef = useRef(0);
  const preRollRef = useRef(createAudioRingBuffer(PRE_ROLL_SAMPLES));
  const resamplerRef = useRef(createResampler(SAMPLE_RATE, SAMPLE_RATE));
  const resamplerRateRef = useRef(SAMPLE_RATE);
  const profileRef = useRef<number[] | undefined>(undefined);
  const commandTextRef = useRef('');
  const processingRef = useRef<Promise<void>>(Promise.resolve());
  const vadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onBufferRef = useRef<(buffer: AudioStreamBuffer) => void>(() => undefined);
  const onCommandRef = useRef(onCommand);
  const onNoCommandRef = useRef(onNoCommand);
  const onPartialCommandRef = useRef(onPartialCommand);
  const onErrorRef = useRef(onError);
  const phraseRef = useRef(phrase);
  const commandModelRef = useRef(commandModel);
  const languageRef = useRef(language);
  const verifySpeakerRef = useRef(verifySpeaker);
  const thresholdRef = useRef(speakerThreshold);
  const endSilenceRef = useRef(endSilenceMs);
  const finishOnFirstTurnRef = useRef(finishOnFirstTurn);
  const maxDurationRef = useRef(maxDurationMs);
  const minTurnSamplesRef = useRef(minTurnSamples);
  const noSpeechRef = useRef(noSpeechMs);
  useEffect(() => { phraseRef.current = phrase; }, [phrase]);
  useEffect(() => { commandModelRef.current = commandModel; }, [commandModel]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { endSilenceRef.current = endSilenceMs; }, [endSilenceMs]);
  useEffect(() => { finishOnFirstTurnRef.current = finishOnFirstTurn; }, [finishOnFirstTurn]);
  useEffect(() => { maxDurationRef.current = maxDurationMs; }, [maxDurationMs]);
  useEffect(() => { minTurnSamplesRef.current = minTurnSamples; }, [minTurnSamples]);
  useEffect(() => { noSpeechRef.current = noSpeechMs; }, [noSpeechMs]);

  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onNoCommandRef.current = onNoCommand; }, [onNoCommand]);
  useEffect(() => { onPartialCommandRef.current = onPartialCommand; }, [onPartialCommand]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { verifySpeakerRef.current = verifySpeaker; }, [verifySpeaker]);
  useEffect(() => { thresholdRef.current = speakerThreshold; }, [speakerThreshold]);

  const audio = useAudioStream({
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => onBufferRef.current(buffer),
    sampleRate: SAMPLE_RATE,
  });
  const stream = audio.stream;

  const clearTimers = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = undefined;
    }
    if (noSpeechTimerRef.current) {
      clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = undefined;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = undefined;
    }
  }, []);

  const stopCapture = useCallback(async () => {
    activeRef.current = false;
    finishingRef.current = true;
    startPromiseRef.current = undefined;
    generationRef.current += 1;
    turnActiveRef.current = false;
    turnChunksRef.current = [];
    silenceSamplesRef.current = 0;
    preRollRef.current.clear();
    clearTimers();
    try {
      stream.stop();
    } catch {
      // Ignore native stop races.
    }
    await deactivateLocalWakeRecordingAsync().catch(() => undefined);
    await resetVad().catch(() => undefined);
  }, [clearTimers, stream]);

  const finishCommand = useCallback(async () => {
    if (!activeRef.current || finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    clearTimers();
    // Let queued VAD frames and their turns finish their speaker check and ASR
    // so accepted text is not lost, then release the microphone.
    await vadQueueRef.current.catch(() => undefined);
    await processingRef.current.catch(() => undefined);
    await stopCapture();
    const text = commandTextRef.current.trim();
    if (text) {
      onCommandRef.current(text);
    } else {
      onNoCommandRef.current();
    }
  }, [clearTimers, stopCapture]);

  const scheduleEnd = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
    }
    endTimerRef.current = setTimeout(() => {
      endTimerRef.current = undefined;
      if (!activeRef.current || finishingRef.current || turnActiveRef.current) {
        return;
      }
      void finishCommand();
    }, endSilenceRef.current);
  }, [finishCommand]);

  const scheduleNoSpeech = useCallback(() => {
    if (noSpeechTimerRef.current) {
      clearTimeout(noSpeechTimerRef.current);
    }
    noSpeechTimerRef.current = setTimeout(() => {
      noSpeechTimerRef.current = undefined;
      if (!activeRef.current || finishingRef.current || turnActiveRef.current || commandTextRef.current.trim()) {
        return;
      }
      void finishCommand();
    }, noSpeechRef.current);
  }, [finishCommand]);

  const processTurn = useCallback((chunks: Float32Array[], generation: number) => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total < minTurnSamplesRef.current) {
      // A cough or door slam can start a VAD turn without producing a usable
      // command. Do not leave the window waiting for the max-duration timer.
      if (commandTextRef.current.trim()) {
        scheduleEnd();
      } else {
        scheduleNoSpeech();
      }
      return;
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    processingRef.current = processingRef.current.then(async () => {
      if (!activeRef.current || generation !== generationRef.current) {
        return;
      }
      if (verifySpeakerRef.current && profileRef.current?.length) {
        const embedding = await computeLocalSpeakerEmbedding(samples);
        const score = embedding ? cosineSimilarity(profileRef.current, embedding) : 0;
        if (!embedding || score < thresholdRef.current) {
          // This turn belongs to the TV, a child, or an unknown speaker. It is
          // discarded before ASR.
          if (commandTextRef.current.trim()) {
            scheduleEnd();
          } else {
            scheduleNoSpeech();
          }
          return;
        }

        if (score < thresholdRef.current + CONFIDENT_SPEAKER_MARGIN && samples.length >= SPLIT_CONSISTENCY_MIN_SAMPLES) {
          const midpoint = Math.floor(samples.length / 2);
          const first = await computeLocalSpeakerEmbedding(samples.subarray(0, midpoint));
          const second = await computeLocalSpeakerEmbedding(samples.subarray(midpoint));
          if (first && second && cosineSimilarity(first, second) < SPLIT_CONSISTENCY_THRESHOLD) {
            // Two different voices dominate the two halves: likely overlap.
            if (commandTextRef.current.trim()) {
              scheduleEnd();
            } else {
              scheduleNoSpeech();
            }
            return;
          }
        }
      }

      const text = await recognizeLocalCommand(samples);
      if (!activeRef.current || generation !== generationRef.current) {
        return;
      }
      if (text) {
        commandTextRef.current = `${commandTextRef.current} ${text}`.trim();
        onPartialCommandRef.current(commandTextRef.current);
        if (finishOnFirstTurnRef.current) {
          // Let the current processing chain settle before finishCommand()
          // awaits it; calling it inline would await itself.
          setTimeout(() => { void finishCommand(); }, 0);
        } else {
          scheduleEnd();
        }
      } else if (commandTextRef.current.trim()) {
        scheduleEnd();
      } else {
        scheduleNoSpeech();
      }
    }).catch((error) => {
      if (activeRef.current && generation === generationRef.current) {
        onErrorRef.current(error instanceof Error ? error.message : 'On-device command recognition failed.');
      }
    });
  }, [finishCommand, scheduleEnd, scheduleNoSpeech]);

  const processFrame = useCallback(async (samples: Float32Array, preRoll: Float32Array, generation: number) => {
    if (finishingRef.current) {
      return;
    }
    const result = await acceptVadSamples(samples);
    if (!activeRef.current || generation !== generationRef.current) {
      return;
    }
    if (!result.success) {
      onErrorRef.current(result.error || 'Voice activity detection failed.');
      return;
    }

    if (result.isSpeechDetected) {
      silenceSamplesRef.current = 0;
      if (noSpeechTimerRef.current) {
        clearTimeout(noSpeechTimerRef.current);
        noSpeechTimerRef.current = undefined;
      }
      if (endTimerRef.current) {
        clearTimeout(endTimerRef.current);
        endTimerRef.current = undefined;
      }
      if (!turnActiveRef.current) {
        turnActiveRef.current = true;
        turnChunksRef.current = [preRoll];
      } else {
        turnChunksRef.current.push(samples);
      }
    } else if (turnActiveRef.current) {
      turnChunksRef.current.push(samples);
      silenceSamplesRef.current += samples.length;
      const ended = result.segments.length > 0
        || silenceSamplesRef.current >= VAD_END_SILENCE_SAMPLES;
      if (ended) {
        const chunks = turnChunksRef.current;
        turnChunksRef.current = [];
        turnActiveRef.current = false;
        silenceSamplesRef.current = 0;
        processTurn(chunks, generation);
      }
    }
  }, [processTurn]);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (!activeRef.current || finishingRef.current) {
      return;
    }
    try {
      const samples = int16ToFloat32(buffer.data, buffer.channels);
      if (buffer.sampleRate !== resamplerRateRef.current) {
        resamplerRef.current = createResampler(buffer.sampleRate, SAMPLE_RATE);
        resamplerRateRef.current = buffer.sampleRate;
      }
      const resampled = resamplerRef.current.push(samples);
      const generation = generationRef.current;
      preRollRef.current.push(resampled);
      const preRoll = preRollRef.current.tail(PRE_ROLL_SAMPLES);
      const task = vadQueueRef.current.then(() => processFrame(resampled, preRoll, generation));
      vadQueueRef.current = task.then(() => undefined, () => undefined);
    } catch {
      // Ignore malformed frames.
    }
  }, [processFrame]);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  useEffect(() => {
    if (!activeRef.current || audio.isStreaming) {
      return;
    }
    const timer = setTimeout(() => {
      if (!activeRef.current || audio.isStreaming) {
        return;
      }
      onErrorRef.current('The microphone stopped while capturing the command.');
      void stopCapture();
    }, 750);
    return () => clearTimeout(timer);
  }, [audio.isStreaming, stopCapture]);

  const start = useCallback((initialSamples?: Float32Array) => {
    if (activeRef.current) {
      return Promise.resolve(true);
    }
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }
    const promise = (async () => {
      if (Platform.OS === 'web') {
        onErrorRef.current('On-device command capture is not available on web.');
        return false;
      }
      const requestGeneration = ++generationRef.current;
      try {
        await ensureLocalCommandRuntime(
          phraseRef.current,
          commandModelRef.current,
          languageRef.current,
          { verifySpeaker: verifySpeakerRef.current },
        );
        if (requestGeneration !== generationRef.current) {
          return false;
        }
        const permission = await requestRecordingPermissionsAsync();
        if (requestGeneration !== generationRef.current) {
          return false;
        }
        if (!permission.granted) {
          onErrorRef.current('Microphone permission is required for the on-device command capture.');
          return false;
        }
        profileRef.current = await loadLocalSpeakerProfile();
        if (requestGeneration !== generationRef.current) {
          return false;
        }
        if (verifySpeakerRef.current && !profileRef.current?.length) {
          onErrorRef.current('Enroll your voice before using speaker-filtered command capture.');
          return false;
        }

        const handoff = initialSamples && initialSamples.length > 0
          ? (initialSamples.length > MAX_HANDOFF_SAMPLES
            ? initialSamples.subarray(initialSamples.length - MAX_HANDOFF_SAMPLES)
            : initialSamples)
          : undefined;
        clearTimers();
        commandTextRef.current = '';
        finishingRef.current = false;
        turnActiveRef.current = false;
        turnChunksRef.current = [];
        silenceSamplesRef.current = 0;
        preRollRef.current = createAudioRingBuffer(
          Math.max(PRE_ROLL_SAMPLES, (handoff?.length ?? 0) + PRE_ROLL_SAMPLES),
        );
        if (handoff) {
          preRollRef.current.push(handoff);
        }
        resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
        resamplerRateRef.current = SAMPLE_RATE;
        processingRef.current = Promise.resolve();
        vadQueueRef.current = Promise.resolve();
        await resetVad();
        if (requestGeneration !== generationRef.current) {
          return false;
        }
        // Let the wake detector's AudioRecord release before claiming the
        // microphone again. The handoff samples above cover this gap.
        await new Promise((resolve) => setTimeout(resolve, HANDOFF_SETTLE_MS));
        if (requestGeneration !== generationRef.current) {
          return false;
        }
        await activateLocalWakeRecordingAsync();
        if (requestGeneration !== generationRef.current) {
          await deactivateLocalWakeRecordingAsync().catch(() => undefined);
          return false;
        }
        activeRef.current = true;
        scheduleNoSpeech();
        if (handoff) {
          const preRoll = preRollRef.current.tail(preRollRef.current.size());
          const task = vadQueueRef.current.then(() => processFrame(handoff, preRoll, requestGeneration));
          vadQueueRef.current = task.then(() => undefined, () => undefined);
        }
        await stream.start();
        if (requestGeneration !== generationRef.current) {
          activeRef.current = false;
          try {
            stream.stop();
          } catch {
            // Ignore a native stop race.
          }
          await deactivateLocalWakeRecordingAsync().catch(() => undefined);
          return false;
        }
        maxTimerRef.current = setTimeout(() => {
          maxTimerRef.current = undefined;
          if (activeRef.current && !finishingRef.current) {
            void finishCommand();
          }
        }, maxDurationRef.current);
        return true;
      } catch (error) {
        activeRef.current = false;
        await deactivateLocalWakeRecordingAsync().catch(() => undefined);
        if (requestGeneration === generationRef.current) {
          onErrorRef.current(error instanceof Error ? error.message : 'Could not start on-device command capture.');
        }
        return false;
      }
    })();
    startPromiseRef.current = promise;
    void promise.finally(() => {
      if (startPromiseRef.current === promise) {
        startPromiseRef.current = undefined;
      }
    });
    return promise;
  }, [clearTimers, finishCommand, processFrame, scheduleNoSpeech, stream]);

  const stop = useCallback(async () => {
    await stopCapture();
  }, [stopCapture]);

  useEffect(() => () => {
    void stopCapture();
  }, [stopCapture]);

  return { start, stop };
}
