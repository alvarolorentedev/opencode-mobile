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
const NO_SPEECH_MS = 6000;
const MAX_COMMAND_MS = 15000;
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
}: LocalCommandCaptureOptions) {
  const activeRef = useRef(false);
  const generationRef = useRef(0);
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
  useEffect(() => { phraseRef.current = phrase; }, [phrase]);
  useEffect(() => { commandModelRef.current = commandModel; }, [commandModel]);
  useEffect(() => { languageRef.current = language; }, [language]);

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
    // Let an in-flight turn finish its speaker check and ASR so accepted text
    // is not lost, then release the microphone.
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
    }, END_SILENCE_MS);
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
    }, NO_SPEECH_MS);
  }, [finishCommand]);

  const processTurn = useCallback((chunks: Float32Array[], generation: number) => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total < MIN_TURN_SAMPLES) {
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
        scheduleEnd();
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
  }, [scheduleEnd, scheduleNoSpeech]);

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
        || silenceSamplesRef.current >= Math.round(0.35 * SAMPLE_RATE);
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
      const samples = int16ToFloat32(buffer.data);
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

  const start = useCallback(async () => {
    if (activeRef.current) {
      return true;
    }
    if (Platform.OS === 'web') {
      onErrorRef.current('On-device command capture is not available on web.');
      return false;
    }
    try {
      await ensureLocalCommandRuntime(phraseRef.current, commandModelRef.current, languageRef.current);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onErrorRef.current('Microphone permission is required for the on-device command capture.');
        return false;
      }
      profileRef.current = await loadLocalSpeakerProfile();
      if (verifySpeakerRef.current && !profileRef.current?.length) {
        onErrorRef.current('Enroll your voice before using speaker-filtered command capture.');
        return false;
      }

      generationRef.current += 1;
      clearTimers();
      commandTextRef.current = '';
      finishingRef.current = false;
      turnActiveRef.current = false;
      turnChunksRef.current = [];
      silenceSamplesRef.current = 0;
      preRollRef.current.clear();
      resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
      resamplerRateRef.current = SAMPLE_RATE;
      processingRef.current = Promise.resolve();
      vadQueueRef.current = Promise.resolve();
      await resetVad();
      await activateLocalWakeRecordingAsync();
      activeRef.current = true;
      await stream.start();
      scheduleNoSpeech();
      maxTimerRef.current = setTimeout(() => {
        maxTimerRef.current = undefined;
        if (activeRef.current && !finishingRef.current) {
          void finishCommand();
        }
      }, MAX_COMMAND_MS);
      return true;
    } catch (error) {
      activeRef.current = false;
      await deactivateLocalWakeRecordingAsync().catch(() => undefined);
      onErrorRef.current(error instanceof Error ? error.message : 'Could not start on-device command capture.');
      return false;
    }
  }, [clearTimers, finishCommand, scheduleNoSpeech, stream]);

  const stop = useCallback(async () => {
    await stopCapture();
  }, [stopCapture]);

  useEffect(() => () => {
    void stopCapture();
  }, [stopCapture]);

  return { start, stop };
}
