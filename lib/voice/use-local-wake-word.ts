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
// Keep a bounded backlog instead of dropping audio while the native KWS bridge
// is busy. A normal queue holds one 100 ms buffer; the cap only matters if
// model loading stalls the device for a few seconds.
const MAX_KWS_QUEUE_SECONDS = 5;
const MAX_KWS_QUEUE_SAMPLES = MAX_KWS_QUEUE_SECONDS * SAMPLE_RATE;

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
  const kwsRunningRef = useRef(false);
  const kwsQueueRef = useRef<Float32Array[]>([]);
  const kwsQueueSamplesRef = useRef(0);
  const generationRef = useRef(0);
  const startPromiseRef = useRef<Promise<boolean> | undefined>(undefined);
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

  const clearKwsQueue = useCallback(() => {
    kwsQueueRef.current = [];
    kwsQueueSamplesRef.current = 0;
  }, []);

  const keepOnlyUnprocessedAudio = useCallback(() => {
    // The KWS queue holds frames captured after the detected phrase. Rebuild
    // the rolling buffer from them so a rejected phrase is dropped without
    // losing the start of a retry spoken during the speaker pass.
    ringRef.current.clear();
    for (const chunk of kwsQueueRef.current) {
      ringRef.current.push(chunk);
    }
  }, []);

  const takeKwsQueue = useCallback((): Float32Array | undefined => {
    const chunks = kwsQueueRef.current;
    if (chunks.length === 0) {
      return undefined;
    }
    kwsQueueRef.current = [];
    kwsQueueSamplesRef.current = 0;
    if (chunks.length === 1) {
      return chunks[0];
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }, []);

  const handleDetected = useCallback(async () => {
    const generation = generationRef.current;
    if (!activeRef.current || busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      // Snapshot the phrase now and leave capture running during the speaker
      // pass. A rejection then keeps the detector live instead of deafening it
      // for a stop/start cycle, so an immediate retry is heard.
      const profile = profileRef.current;
      const segment = verifySpeakerRef.current && profile?.length
        ? ringRef.current.tail(SPEAKER_SEGMENT_SECONDS * SAMPLE_RATE)
        : undefined;
      if (segment && profile) {
        const embedding = await computeLocalSpeakerEmbedding(segment);
        if (generation !== generationRef.current || !activeRef.current) {
          return;
        }
        const score = embedding ? cosineSimilarity(profile, embedding) : 0;
        if (!embedding || score < thresholdRef.current) {
          // Drop the rejected phrase before the next attempt is verified.
          keepOnlyUnprocessedAudio();
          onRejectedRef.current();
          return;
        }
      }

      if (generation !== generationRef.current || !activeRef.current) {
        return;
      }
      // Verified (or verification is off): hand the microphone to command
      // capture. Invalidate any in-flight KWS work before stopping.
      activeRef.current = false;
      generationRef.current += 1;
      clearKwsQueue();
      try {
        stream.stop();
      } catch {
        // Ignore a native stop race; the provider will start the OS recognizer.
      }
      onWakeRef.current();
    } catch (error) {
      // A broken speaker or wake pass should fall back to a clean re-arm rather
      // than leaving the detector running in a failing state.
      activeRef.current = false;
      generationRef.current += 1;
      clearKwsQueue();
      try {
        stream.stop();
      } catch {
        // Ignore a native stop race.
      }
      onErrorRef.current(error instanceof Error ? error.message : 'On-device wake word failed.');
    } finally {
      busyRef.current = false;
    }
  }, [clearKwsQueue, keepOnlyUnprocessedAudio, stream]);

  const drainKwsQueue = useCallback(async () => {
    if (kwsRunningRef.current) {
      return;
    }
    kwsRunningRef.current = true;
    const generation = generationRef.current;
    try {
      while (generation === generationRef.current && activeRef.current) {
        const chunk = takeKwsQueue();
        if (!chunk) {
          break;
        }
        let result;
        try {
          result = await acceptWakeWordSamples(chunk);
        } catch {
          continue;
        }
        if (generation !== generationRef.current) {
          break;
        }
        if (result?.detected) {
          await handleDetected();
        }
      }
    } finally {
      kwsRunningRef.current = false;
    }
  }, [handleDetected, takeKwsQueue]);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (!activeRef.current) {
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
      if (resampled.length === 0) {
        return;
      }

      // KWS inference is serialized in the native bridge. Queue frames rather
      // than dropping them so a slow inference pass cannot cut a phrase in half.
      const queue = kwsQueueRef.current;
      queue.push(resampled);
      kwsQueueSamplesRef.current += resampled.length;
      while (kwsQueueSamplesRef.current > MAX_KWS_QUEUE_SAMPLES && queue.length > 1) {
        const dropped = queue.shift();
        kwsQueueSamplesRef.current -= dropped?.length ?? 0;
      }
      void drainKwsQueue();
    } catch {
      // A malformed frame should not tear down conversation mode.
    }
  }, [drainKwsQueue]);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    busyRef.current = false;
    startPromiseRef.current = undefined;
    generationRef.current += 1;
    clearKwsQueue();
    try {
      stream.stop();
    } catch {
      // Ignore transient native stop errors.
    }
    await deactivateLocalWakeRecordingAsync().catch(() => undefined);
    await resetWakeWordStream().catch(() => undefined);
    ringRef.current.clear();
  }, [clearKwsQueue, stream]);

  const start = useCallback(() => {
    if (activeRef.current) {
      return Promise.resolve(true);
    }
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }
    const promise = (async () => {
      if (Platform.OS === 'web') {
        onErrorRef.current('On-device wake word is not available on web.');
        return false;
      }
      // Any stop() or accepted wake increments this token, so a start that was
      // overtaken by one of those cannot re-open the microphone afterwards.
      const startGeneration = ++generationRef.current;
      try {
        if (getLocalVoiceModelStatus(commandModelRef.current) !== 'ready') {
          onErrorRef.current('Install the on-device wake-word models first.');
          return false;
        }
        await ensureLocalVoiceRuntime(phraseRef.current);
        if (startGeneration !== generationRef.current) {
          return false;
        }
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          onErrorRef.current('Microphone permission is required for the on-device wake word.');
          return false;
        }
        profileRef.current = await loadLocalSpeakerProfile();
        if (startGeneration !== generationRef.current) {
          return false;
        }
        if (verifySpeakerRef.current && !profileRef.current?.length) {
          onErrorRef.current('Enroll your voice or turn off voice verification before using the on-device wake word.');
          return false;
        }
        clearKwsQueue();
        busyRef.current = false;
        ringRef.current.clear();
        resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
        resamplerRateRef.current = SAMPLE_RATE;
        await resetWakeWordStream();
        if (startGeneration !== generationRef.current) {
          return false;
        }
        await activateLocalWakeRecordingAsync();
        if (startGeneration !== generationRef.current) {
          await deactivateLocalWakeRecordingAsync().catch(() => undefined);
          return false;
        }
        // Mark active before start() resolves so the first captured buffer is
        // not discarded while the native call is still settling.
        activeRef.current = true;
        try {
          await stream.start();
        } catch (error) {
          activeRef.current = false;
          throw error;
        }
        if (startGeneration !== generationRef.current) {
          activeRef.current = false;
          try {
            stream.stop();
          } catch {
            // Ignore a native stop race.
          }
          await deactivateLocalWakeRecordingAsync().catch(() => undefined);
          return false;
        }
        // Warm the much larger VAD/ASR models while the wake detector is live, so
        // the command window after a wake is not delayed by model loading.
        void ensureLocalCommandRuntime(phraseRef.current, commandModelRef.current, languageRef.current).catch(() => undefined);
        return true;
      } catch (error) {
        activeRef.current = false;
        await deactivateLocalWakeRecordingAsync().catch(() => undefined);
        if (startGeneration === generationRef.current) {
          onErrorRef.current(error instanceof Error ? error.message : 'Could not start the on-device wake word.');
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
  }, [clearKwsQueue, stream]);

  useEffect(() => () => {
    activeRef.current = false;
    generationRef.current += 1;
    clearKwsQueue();
    try {
      stream.stop();
    } catch {
      // Ignore unmount races.
    }
    void deactivateLocalWakeRecordingAsync().catch(() => undefined);
  }, [clearKwsQueue, stream]);

  return { start, stop };
}
