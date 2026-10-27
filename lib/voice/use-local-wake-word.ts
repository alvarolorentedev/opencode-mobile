import { requestRecordingPermissionsAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { activateLocalWakeRecordingAsync, deactivateLocalWakeRecordingAsync } from '@/lib/voice/local-wake-word/audio-session';
import { getLocalVoiceModelStatus } from '@/lib/voice/local-wake-word/models';
import { createAudioRingBuffer, createResampler, int16ToFloat32 } from '@/lib/voice/local-wake-word/pcm';
import { acceptWakeWordSamples, computeLocalSpeakerEmbedding, ensureLocalCommandRuntime, ensureLocalVoiceRuntime, resetWakeWordStream } from '@/lib/voice/local-wake-word/runtime';
import { cosineSimilarity } from '@/lib/voice/local-wake-word/similarity';
import { loadLocalSpeakerProfile } from '@/lib/voice/local-wake-word/speaker-profile';
import type { LocalCommandModelId, LocalWakePhraseId } from '@/lib/voice/local-wake-word/types';

const SAMPLE_RATE = 16000;
const RING_SECONDS = 2.5;
const SPEAKER_SEGMENT_SECONDS = 2;

export type LocalWakeWordOptions = {
  commandModel: LocalCommandModelId;
  language?: string;
  phrase: LocalWakePhraseId;
  verifySpeaker: boolean;
  speakerThreshold: number;
  onWake: () => void;
  onRejected: () => void;
  onError: (message: string) => void;
};

export function useLocalWakeWord({
  commandModel,
  language,
  onError,
  onRejected,
  onWake,
  phrase,
  speakerThreshold,
  verifySpeaker,
}: LocalWakeWordOptions) {
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const kwsPendingRef = useRef(false);
  const onBufferRef = useRef<(buffer: AudioStreamBuffer) => void>(() => undefined);
  const resamplerRef = useRef(createResampler(SAMPLE_RATE, SAMPLE_RATE));
  const resamplerRateRef = useRef(SAMPLE_RATE);
  const ringRef = useRef(createAudioRingBuffer(RING_SECONDS * SAMPLE_RATE));
  const profileRef = useRef<number[] | undefined>(undefined);
  const onWakeRef = useRef(onWake);
  const onRejectedRef = useRef(onRejected);
  const onErrorRef = useRef(onError);
  const phraseRef = useRef(phrase);
  const commandModelRef = useRef(commandModel);
  const languageRef = useRef(language);
  const verifySpeakerRef = useRef(verifySpeaker);
  const thresholdRef = useRef(speakerThreshold);

  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);
  useEffect(() => { onRejectedRef.current = onRejected; }, [onRejected]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { phraseRef.current = phrase; }, [phrase]);
  useEffect(() => { commandModelRef.current = commandModel; }, [commandModel]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { verifySpeakerRef.current = verifySpeaker; }, [verifySpeaker]);
  useEffect(() => { thresholdRef.current = speakerThreshold; }, [speakerThreshold]);

  const audio = useAudioStream({
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => onBufferRef.current(buffer),
    sampleRate: SAMPLE_RATE,
  });
  const stream = audio.stream;

  const handleDetected = useCallback(async () => {
    if (!activeRef.current || busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      // Stop capture before the expensive speaker pass. The ring buffer already
      // holds the phrase and a little pre-roll.
      activeRef.current = false;
      try {
        stream.stop();
      } catch {
        // Ignore a native stop race; the provider will start the OS recognizer.
      }

      if (verifySpeakerRef.current && profileRef.current?.length) {
        const segment = ringRef.current.tail(SPEAKER_SEGMENT_SECONDS * SAMPLE_RATE);
        const embedding = await computeLocalSpeakerEmbedding(segment);
        const score = embedding ? cosineSimilarity(profileRef.current, embedding) : 0;
        if (!embedding || score < thresholdRef.current) {
          onRejectedRef.current();
          return;
        }
      }

      onWakeRef.current();
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : 'On-device wake word failed.');
    } finally {
      busyRef.current = false;
    }
  }, [stream]);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (!activeRef.current || busyRef.current) {
      return;
    }
    try {
      const samples = int16ToFloat32(buffer.data);
      if (buffer.sampleRate !== resamplerRateRef.current) {
        resamplerRef.current = createResampler(buffer.sampleRate, SAMPLE_RATE);
        resamplerRateRef.current = buffer.sampleRate;
      }
      const resampled = resamplerRef.current.push(samples);
      ringRef.current.push(resampled);

      // KWS inference is serialized in the native bridge. Drop frames while a
      // previous call is in flight instead of building an unbounded queue.
      if (kwsPendingRef.current) {
        return;
      }
      kwsPendingRef.current = true;
      void acceptWakeWordSamples(resampled).then((result) => {
        if (result?.detected) {
          void handleDetected();
        }
      }).catch(() => undefined).finally(() => {
        kwsPendingRef.current = false;
      });
    } catch {
      // A malformed frame should not tear down conversation mode.
    }
  }, [handleDetected]);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    busyRef.current = false;
    kwsPendingRef.current = false;
    try {
      stream.stop();
    } catch {
      // Ignore transient native stop errors.
    }
    await deactivateLocalWakeRecordingAsync().catch(() => undefined);
    await resetWakeWordStream().catch(() => undefined);
    ringRef.current.clear();
  }, [stream]);

  const start = useCallback(async () => {
    if (activeRef.current) {
      return true;
    }
    if (Platform.OS === 'web') {
      onErrorRef.current('On-device wake word is not available on web.');
      return false;
    }
    try {
      if (getLocalVoiceModelStatus(commandModelRef.current) !== 'ready') {
        onErrorRef.current('Install the on-device wake-word models first.');
        return false;
      }
      await ensureLocalVoiceRuntime(phraseRef.current);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onErrorRef.current('Microphone permission is required for the on-device wake word.');
        return false;
      }
      profileRef.current = await loadLocalSpeakerProfile();
      if (verifySpeakerRef.current && !profileRef.current?.length) {
        onErrorRef.current('Enroll your voice or turn off voice verification before using the on-device wake word.');
        return false;
      }
      ringRef.current.clear();
      busyRef.current = false;
      kwsPendingRef.current = false;
      resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
      resamplerRateRef.current = SAMPLE_RATE;
      await resetWakeWordStream();
      await activateLocalWakeRecordingAsync();
      await stream.start();
      activeRef.current = true;
      // Warm the much larger VAD/ASR models while the wake detector is live, so
      // the command window after a wake is not delayed by model loading.
      void ensureLocalCommandRuntime(phraseRef.current, commandModelRef.current, languageRef.current).catch(() => undefined);
      return true;
    } catch (error) {
      activeRef.current = false;
      await deactivateLocalWakeRecordingAsync().catch(() => undefined);
      onErrorRef.current(error instanceof Error ? error.message : 'Could not start the on-device wake word.');
      return false;
    }
  }, [stream]);

  useEffect(() => () => {
    activeRef.current = false;
    try {
      stream.stop();
    } catch {
      // Ignore unmount races.
    }
    void deactivateLocalWakeRecordingAsync().catch(() => undefined);
  }, [stream]);

  return { start, stop };
}
