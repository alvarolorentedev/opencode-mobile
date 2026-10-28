import { requestRecordingPermissionsAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { activateLocalWakeRecordingAsync, deactivateLocalWakeRecordingAsync } from '@/lib/voice/local-wake-word/audio-session';
import { createResampler, int16ToFloat32 } from '@/lib/voice/local-wake-word/pcm';
import { computeLocalSpeakerEmbedding, ensureLocalSpeakerRuntime } from '@/lib/voice/local-wake-word/runtime';
import { averageEmbeddings } from '@/lib/voice/local-wake-word/similarity';
import {
  clearLocalSpeakerProfile,
  loadLocalSpeakerProfile,
  saveLocalSpeakerProfile,
} from '@/lib/voice/local-wake-word/speaker-profile';

const SAMPLE_RATE = 16000;
// Capture a single natural sample, then build three embeddings from it and
// average them. That avoids a multi-step recording UI while reducing the
// variance of a single short clip.
const ENROLLMENT_SECONDS = 12;
const ENROLLMENT_CHUNKS = 3;

export type LocalVoiceEnrollmentStatus = 'idle' | 'recording' | 'saving' | 'error';

export function useLocalVoiceEnrollment() {
  const [hasProfile, setHasProfile] = useState(false);
  const [status, setStatus] = useState<LocalVoiceEnrollmentStatus>('idle');
  const [error, setError] = useState<string>();
  const recordingRef = useRef(false);
  const mountedRef = useRef(true);
  const chunksRef = useRef<Float32Array[]>([]);
  const resamplerRef = useRef(createResampler(SAMPLE_RATE, SAMPLE_RATE));
  const resamplerRateRef = useRef(SAMPLE_RATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishRef = useRef<() => void>(() => undefined);
  const onBufferRef = useRef<(buffer: AudioStreamBuffer) => void>(() => undefined);

  const audio = useAudioStream({
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => onBufferRef.current(buffer),
    sampleRate: SAMPLE_RATE,
  });
  const stream = audio.stream;

  useEffect(() => {
    void loadLocalSpeakerProfile().then((profile) => setHasProfile(Boolean(profile?.length)));
  }, []);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (!recordingRef.current) {
      return;
    }
    try {
      const samples = int16ToFloat32(buffer.data);
      if (buffer.sampleRate !== resamplerRateRef.current) {
        resamplerRef.current = createResampler(buffer.sampleRate, SAMPLE_RATE);
        resamplerRateRef.current = buffer.sampleRate;
      }
      chunksRef.current.push(resamplerRef.current.push(samples));
    } catch {
      // Ignore malformed frames; a later sample can still produce a profile.
    }
  }, []);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  const stopCapture = useCallback(async () => {
    recordingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    try {
      stream.stop();
    } catch {
      // Ignore native stop races.
    }
    await deactivateLocalWakeRecordingAsync().catch(() => undefined);
  }, [stream]);

  const finishEnrollment = useCallback(async () => {
    if (!recordingRef.current) {
      return;
    }
    await stopCapture();
    setStatus('saving');
    const totalSamples = chunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    chunksRef.current = [];
    if (samples.length < SAMPLE_RATE) {
      setStatus('error');
      setError('The voice sample was too short. Try again and speak for a few seconds.');
      return;
    }
    try {
      const chunkLength = Math.floor(samples.length / ENROLLMENT_CHUNKS);
      const embeddings: number[][] = [];
      for (let index = 0; index < ENROLLMENT_CHUNKS; index++) {
        const start = index * chunkLength;
        const end = index === ENROLLMENT_CHUNKS - 1 ? samples.length : start + chunkLength;
        if (end - start < SAMPLE_RATE) {
          continue;
        }
        const embedding = await computeLocalSpeakerEmbedding(samples.subarray(start, end));
        if (embedding) {
          embeddings.push(embedding);
        }
      }
      const embedding = embeddings.length > 1 ? averageEmbeddings(embeddings) : embeddings[0];
      if (!embedding) {
        throw new Error('Could not build a voice profile from that sample.');
      }
      await saveLocalSpeakerProfile(embedding);
      setHasProfile(true);
      setStatus('idle');
      setError(undefined);
    } catch (enrollmentError) {
      setStatus('error');
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Could not enroll this voice.');
    }
  }, [stopCapture]);
  useEffect(() => {
    finishRef.current = () => { void finishEnrollment(); };
  }, [finishEnrollment]);

  const enroll = useCallback(async () => {
    if (Platform.OS === 'web') {
      setStatus('error');
      setError('Voice enrollment is not supported on web.');
      return;
    }
    if (recordingRef.current) {
      return;
    }
    setError(undefined);
    setStatus('recording');
    chunksRef.current = [];
    resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
    resamplerRateRef.current = SAMPLE_RATE;
    try {
      await ensureLocalSpeakerRuntime();
      if (!mountedRef.current) return;
      const permission = await requestRecordingPermissionsAsync();
      if (!mountedRef.current) return;
      if (!permission.granted) {
        throw new Error('Microphone permission is required to enroll your voice.');
      }
      await activateLocalWakeRecordingAsync();
      if (!mountedRef.current) {
        await deactivateLocalWakeRecordingAsync().catch(() => undefined);
        return;
      }
      recordingRef.current = true;
      await stream.start();
      if (!mountedRef.current) {
        await stopCapture();
        return;
      }
      timerRef.current = setTimeout(() => finishRef.current(), ENROLLMENT_SECONDS * 1000);
    } catch (enrollmentError) {
      recordingRef.current = false;
      setStatus('error');
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Could not start voice enrollment.');
      await deactivateLocalWakeRecordingAsync().catch(() => undefined);
    }
  }, [stream, stopCapture]);

  const clearProfile = useCallback(async () => {
    await clearLocalSpeakerProfile();
    setHasProfile(false);
    setError(undefined);
    setStatus('idle');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recordingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      try {
        stream.stop();
      } catch {
        // Ignore unmount races.
      }
      void deactivateLocalWakeRecordingAsync().catch(() => undefined);
    };
  }, [stream]);

  return {
    clearError: useCallback(() => setError(undefined), []),
    clearProfile,
    enroll,
    error,
    hasProfile,
    isRecording: status === 'recording',
    status,
  };
}
