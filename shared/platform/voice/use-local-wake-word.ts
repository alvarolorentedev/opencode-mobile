import { useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { i18n } from '@/shared/i18n/index';
import { activateLocalWakeRecordingAsync, deactivateLocalWakeRecordingAsync } from '@/shared/platform/voice/local-wake-word/audio-session';
import { getLocalVoiceModelStatus } from '@/shared/platform/voice/local-wake-word/models';
import { createAudioRingBuffer, createResampler, int16ToFloat32, selectSpeechSegment } from '@/shared/platform/voice/local-wake-word/pcm';
import { acceptWakeWordSamples, computeLocalSpeakerEmbedding, ensureLocalCommandRuntime, ensureLocalVoiceRuntime, resetWakeWordStream } from '@/shared/platform/voice/local-wake-word/runtime';
import { cosineSimilarity } from '@/shared/platform/voice/local-wake-word/similarity';
import { loadLocalSpeakerProfile } from '@/shared/platform/voice/local-wake-word/speaker-profile';
import { ensureLocalVoicePermissionAsync } from '@/shared/platform/voice/permissions';
import { recordWakeDiagnostic } from '@/shared/platform/voice/voice-diagnostics';
import type { LocalCommandModelId, LocalWakePhraseId } from '@/shared/platform/voice/local-wake-word/types';

const SAMPLE_RATE = 16000;
const RING_SECONDS = 2.5;
const SPEAKER_SEGMENT_SECONDS = 2;
// Keep a bounded backlog instead of dropping audio while the native KWS bridge
// is busy. A normal queue holds one 100 ms buffer; the cap only matters if
// model loading stalls the device for a few seconds.
const MAX_KWS_QUEUE_SECONDS = 5;
const MAX_KWS_QUEUE_SAMPLES = MAX_KWS_QUEUE_SECONDS * SAMPLE_RATE;
const MAX_HANDOFF_SAMPLES = Math.round(2.5 * SAMPLE_RATE);
const MAX_CONSECUTIVE_FAILURES = 3;
const STREAM_RECOVERY_MS = 750;
const FIRST_FRAME_TIMEOUT_MS = 3000;

export type LocalWakeWordOptions = {
  commandModel: LocalCommandModelId;
  language?: string;
  phrase: LocalWakePhraseId;
  verifySpeaker: boolean;
  speakerThreshold: number;
  onWake: (samples?: Float32Array) => void;
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
  const recorderStartRef = useRef<Promise<boolean> | undefined>(undefined);
  const recordingOwnedRef = useRef(false);
  const firstFrameRef = useRef<((received: boolean) => void) | undefined>(undefined);
  const consecutiveFailuresRef = useRef(0);
  const failingRef = useRef(false);
  const recoveringStreamRef = useRef(false);
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

  const stopStream = useCallback(() => {
    try { stream.stop(); } catch { /* Native stop can race with teardown. */ }
  }, [stream]);

  const stopRecording = useCallback(async () => {
    if (!recordingOwnedRef.current) return;
    recordingOwnedRef.current = false;
    firstFrameRef.current?.(false);
    stopStream();
    await recorderStartRef.current?.catch(() => undefined);
    await deactivateLocalWakeRecordingAsync().catch(() => undefined);
  }, [stopStream]);

  const failWake = useCallback((message: string) => {
    if (failingRef.current) return;
    failingRef.current = true;
    activeRef.current = false;
    generationRef.current += 1;
    clearKwsQueue();
    void stopRecording();
    onErrorRef.current(message);
  }, [clearKwsQueue, stopRecording]);

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
        ? selectSpeechSegment(
          ringRef.current.tail(SPEAKER_SEGMENT_SECONDS * SAMPLE_RATE),
          SAMPLE_RATE,
        )
        : undefined;
      if (segment && segment.length > 0 && profile) {
        const embedding = await computeLocalSpeakerEmbedding(segment);
        if (generation !== generationRef.current || !activeRef.current) {
          return;
        }
        const score = embedding ? cosineSimilarity(profile, embedding) : 0;
        if (!embedding || score < thresholdRef.current) {
          // Drop the rejected phrase before the next attempt is verified.
          keepOnlyUnprocessedAudio();
          recordWakeDiagnostic('local', 'speaker-rejected');
          onRejectedRef.current();
          return;
        }
      }

      if (generation !== generationRef.current || !activeRef.current) {
        return;
      }
      // Verified (or verification is off): hand every frame captured after the
      // keyword to command capture. Those frames were recorded while the
      // speaker check was running; dropping them clips the start of the
      // command and makes local transcription look unreliable.
      const pending = takeKwsQueue();
      const handoff = pending && pending.length > MAX_HANDOFF_SAMPLES
        ? pending.subarray(pending.length - MAX_HANDOFF_SAMPLES)
        : pending;
      activeRef.current = false;
      generationRef.current += 1;
      stopStream();
      recordWakeDiagnostic('local', 'detected');
      onWakeRef.current(handoff);
    } catch (error) {
      // A broken speaker or wake pass should fall back to a clean re-arm rather
      // than leaving the detector running in a failing state.
      if (generation === generationRef.current) {
        failWake(error instanceof Error ? error.message : 'On-device wake word failed.');
      }
    } finally {
      busyRef.current = false;
    }
  }, [failWake, keepOnlyUnprocessedAudio, stopStream, takeKwsQueue]);

  const recoverKwsFailure = useCallback(async (message: string, generation: number) => {
    if (generation !== generationRef.current || !activeRef.current) return false;
    recordWakeDiagnostic('local', 'decode-failed');
    consecutiveFailuresRef.current += 1;
    if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
      failWake(message);
      return false;
    }
    await resetWakeWordStream();
    return generation === generationRef.current;
  }, [failWake]);

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
        } catch (error) {
          const recovered = await recoverKwsFailure(
            error instanceof Error ? error.message : 'On-device wake word failed.', generation,
          );
          if (!recovered) {
            break;
          }
          continue;
        }
        if (generation !== generationRef.current || !activeRef.current) {
          break;
        }
        if (!result?.success) {
          const recovered = await recoverKwsFailure(result?.error || 'On-device wake word failed.', generation);
          if (!recovered) {
            break;
          }
          continue;
        }
        consecutiveFailuresRef.current = 0;
        if (result.detected) {
          await handleDetected();
        }
      }
    } finally {
      kwsRunningRef.current = false;
    }
  }, [handleDetected, recoverKwsFailure, takeKwsQueue]);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (!activeRef.current) {
      return;
    }
    try {
      const samples = int16ToFloat32(buffer.data, buffer.channels);
      if (buffer.sampleRate !== resamplerRateRef.current) {
        resamplerRef.current = createResampler(buffer.sampleRate, SAMPLE_RATE);
        resamplerRateRef.current = buffer.sampleRate;
      }
      const resampled = resamplerRef.current.push(samples);
      ringRef.current.push(resampled);
      if (resampled.length === 0) return;
      firstFrameRef.current?.(true);

      // KWS inference is serialized in the native bridge. Queue frames rather
      // than dropping them so a slow inference pass cannot cut a phrase in half.
      const queue = kwsQueueRef.current;
      queue.push(resampled);
      kwsQueueSamplesRef.current += resampled.length;
      while (kwsQueueSamplesRef.current > MAX_KWS_QUEUE_SAMPLES && queue.length > 1) {
        const dropped = queue.shift();
        kwsQueueSamplesRef.current -= dropped?.length ?? 0;
      }
      if (!firstFrameRef.current) void drainKwsQueue();
    } catch {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        failWake('The microphone audio could not be processed.');
      }
    }
  }, [drainKwsQueue, failWake]);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  const startRecording = useCallback((generation: number) => {
    const starting = (async () => {
      if (AppState.currentState === 'background') return false;
      recordingOwnedRef.current = true;
      await activateLocalWakeRecordingAsync();
      if (generation !== generationRef.current) return false;
      if (AppState.currentState === 'background') throw new Error(i18n.t('settings:voice.localWake.microphoneStartFailed'));
      const startedAt = Date.now();
      let resolveFirstFrame!: (received: boolean) => void;
      const firstFrame = new Promise<boolean>((resolve) => { resolveFirstFrame = resolve; });
      firstFrameRef.current = resolveFirstFrame;
      let timer: ReturnType<typeof setTimeout> | undefined;
      activeRef.current = true;
      try {
        await stream.start();
        if (generation !== generationRef.current) {
          stopStream();
          return false;
        }
        timer = setTimeout(() => resolveFirstFrame(false), FIRST_FRAME_TIMEOUT_MS);
        const received = await firstFrame;
        if (generation !== generationRef.current) return false;
        const duration = Date.now() - startedAt;
        if (!received) {
          recordWakeDiagnostic('local', 'no-microphone-frames', duration);
          throw new Error(i18n.t('settings:voice.localWake.microphoneStartFailed'));
        }
        recordWakeDiagnostic('local', 'ready', duration);
        return true;
      } finally {
        clearTimeout(timer);
        firstFrameRef.current = undefined;
      }
    })();
    recorderStartRef.current = starting;
    return starting.finally(() => { recorderStartRef.current = undefined; });
  }, [stopStream, stream]);

  useEffect(() => {
    if (!activeRef.current || audio.isStreaming) return;
    const generation = generationRef.current;
    const timer = setTimeout(() => {
      if (generation !== generationRef.current || !activeRef.current || startPromiseRef.current || recoveringStreamRef.current) return;
      recoveringStreamRef.current = true;
      void (async () => {
        try {
          await resetWakeWordStream();
          if (generation !== generationRef.current || !await startRecording(generation)) return;
          void drainKwsQueue();
        } catch {
          if (generation === generationRef.current) {
            failWake(i18n.t('settings:voice.localWake.microphoneStartFailed'));
          }
        } finally {
          if (generation === generationRef.current) recoveringStreamRef.current = false;
        }
      })();
    }, STREAM_RECOVERY_MS);
    return () => clearTimeout(timer);
  }, [audio.isStreaming, drainKwsQueue, failWake, startRecording]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    busyRef.current = false;
    startPromiseRef.current = undefined;
    failingRef.current = false;
    consecutiveFailuresRef.current = 0;
    recoveringStreamRef.current = false;
    generationRef.current += 1;
    clearKwsQueue();
    ringRef.current.clear();
    const ownedRecording = recordingOwnedRef.current;
    await stopRecording();
    if (ownedRecording) await resetWakeWordStream();
  }, [clearKwsQueue, stopRecording]);

  const start = useCallback(() => {
    if (AppState.currentState === 'background') return Promise.resolve(false);
    if (startPromiseRef.current) return startPromiseRef.current;
    if (recorderStartRef.current) return recorderStartRef.current.catch(() => false);
    if (activeRef.current) return Promise.resolve(true);
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
        await ensureLocalVoiceRuntime(phraseRef.current, { verifySpeaker: verifySpeakerRef.current });
        if (startGeneration !== generationRef.current) {
          return false;
        }
        const permission = await ensureLocalVoicePermissionAsync();
        if (startGeneration !== generationRef.current) return false;
        if (!permission.granted) {
          onErrorRef.current('Microphone permission is required for the on-device wake word.');
          return false;
        }
        const profile = await loadLocalSpeakerProfile();
        if (startGeneration !== generationRef.current) {
          return false;
        }
        profileRef.current = profile;
        if (verifySpeakerRef.current && !profile?.length) {
          onErrorRef.current('Enroll your voice or turn off voice verification before using the on-device wake word.');
          return false;
        }
        clearKwsQueue();
        busyRef.current = false;
        failingRef.current = false;
        consecutiveFailuresRef.current = 0;
        recoveringStreamRef.current = false;
        ringRef.current.clear();
        resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
        resamplerRateRef.current = SAMPLE_RATE;
        await resetWakeWordStream();
        if (startGeneration !== generationRef.current) {
          return false;
        }
        if (!await startRecording(startGeneration)) return false;
        // Warm the much larger VAD/ASR models while the wake detector is live, so
        // the command window after a wake is not delayed by model loading.
        void ensureLocalCommandRuntime(
          phraseRef.current,
          commandModelRef.current,
          languageRef.current,
          { verifySpeaker: verifySpeakerRef.current },
        ).catch(() => undefined);
        void drainKwsQueue();
        return true;
      } catch (error) {
        if (startGeneration !== generationRef.current) return false;
        activeRef.current = false;
        clearKwsQueue();
        await stopRecording();
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
  }, [clearKwsQueue, drainKwsQueue, startRecording, stopRecording]);

  useEffect(() => () => { void stop(); }, [stop]);

  return { start, stop };
}
