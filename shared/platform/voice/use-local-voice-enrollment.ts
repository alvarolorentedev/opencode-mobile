import { useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { ensureLocalVoicePermissionAsync } from '@/shared/platform/voice/permissions';
import { audioCaptureErrorCode, recordVoiceDiagnostic, type VoiceCancellation, type VoiceDiagnosticPhase } from '@/shared/platform/voice/voice-diagnostics';
import { i18n } from '@/shared/i18n/index';
import { activateLocalWakeRecordingAsync, deactivateLocalWakeRecordingAsync } from '@/shared/platform/voice/local-wake-word/audio-session';
import { createResampler, int16ToFloat32, selectSpeechSegment } from '@/shared/platform/voice/local-wake-word/pcm';
import { computeLocalSpeakerEmbedding, ensureLocalSpeakerRuntime } from '@/shared/platform/voice/local-wake-word/runtime';
import { averageEmbeddings, cosineSimilarity } from '@/shared/platform/voice/local-wake-word/similarity';
import { clearLocalSpeakerProfile, loadLocalSpeakerProfile, saveLocalSpeakerProfile } from '@/shared/platform/voice/local-wake-word/speaker-profile';

const SAMPLE_RATE = 16000;
// Capture a single natural sample, then build three embeddings from it and
// average them. That avoids a multi-step recording UI while reducing the
// variance of a single short clip.
const ENROLLMENT_SECONDS = 12;
const ENROLLMENT_CHUNKS = 3;
const FIRST_FRAME_TIMEOUT_MS = 3000;

export type LocalVoiceEnrollmentStatus = 'idle' | 'starting' | 'recording' | 'saving' | 'committing' | 'error';

export function useLocalVoiceEnrollment() {
  const [hasProfile, setHasProfile] = useState(false);
  const [status, setStatus] = useState<LocalVoiceEnrollmentStatus>('idle');
  const [error, setError] = useState<string>();
  const recordingRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const startingRef = useRef(false);
  const attemptAtRef = useRef<number | undefined>(undefined);
  const phaseRef = useRef<VoiceDiagnosticPhase>('preflight');
  const firstFrameRef = useRef(false);
  const firstFrameTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const audioOwnedRef = useRef(false);
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
    if (!recordingRef.current || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
      return;
    }
    try {
      const samples = int16ToFloat32(buffer.data, buffer.channels);
      if (buffer.sampleRate !== resamplerRateRef.current) {
        resamplerRef.current = createResampler(buffer.sampleRate, SAMPLE_RATE);
        resamplerRateRef.current = buffer.sampleRate;
      }
      if (samples.length === 0) return;
      chunksRef.current.push(resamplerRef.current.push(samples));
      if (!firstFrameRef.current) {
        firstFrameRef.current = true;
        phaseRef.current = 'sample';
        clearTimeout(firstFrameTimerRef.current);
        setStatus('recording');
        timerRef.current = setTimeout(() => finishRef.current(), ENROLLMENT_SECONDS * 1000);
      }
    } catch {
      // Ignore malformed frames; a later sample can still produce a profile.
    }
  }, []);

  useEffect(() => {
    onBufferRef.current = handleAudioBuffer;
  }, [handleAudioBuffer]);

  const stopCapture = useCallback(async () => {
    recordingRef.current = false;
    clearTimeout(firstFrameTimerRef.current);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    try {
      stream.stop();
    } catch {
      // Ignore native stop races.
    }
    if (audioOwnedRef.current) {
      audioOwnedRef.current = false;
      await deactivateLocalWakeRecordingAsync().catch(() => undefined);
    }
  }, [stream]);

  const finishEnrollment = useCallback(async () => {
    if (!recordingRef.current) {
      return;
    }
    const generation = generationRef.current;
    await stopCapture();
    if (!mountedRef.current || generation !== generationRef.current) return;
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
      recordVoiceDiagnostic('failed', { source: 'enrollment', phase: 'sample', reason: 'incomplete-capture' });
      attemptAtRef.current = undefined;
      setStatus('error');
      setError('The voice sample was too short. Try again and speak for a few seconds.');
      return;
    }
    phaseRef.current = 'embedding';
    try {
      const chunkLength = Math.floor(samples.length / ENROLLMENT_CHUNKS);
      const embeddings: number[][] = [];
      for (let index = 0; index < ENROLLMENT_CHUNKS; index++) {
        const start = index * chunkLength;
        const end = index === ENROLLMENT_CHUNKS - 1 ? samples.length : start + chunkLength;
        if (end - start < SAMPLE_RATE) {
          continue;
        }
        const speech = selectSpeechSegment(
          samples.subarray(start, end),
          SAMPLE_RATE,
          4,
        );
        if (speech.length < Math.round(0.5 * SAMPLE_RATE)) {
          continue;
        }
        const embedding = await computeLocalSpeakerEmbedding(speech);
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (embedding) {
          embeddings.push(embedding);
        }
      }
      if (embeddings.length < 2) {
        recordVoiceDiagnostic('blocked', { source: 'enrollment', phase: 'sample', reason: 'insufficient-speech' });
        setStatus('error');
        setError('Speak for longer, with at least two clear sentences, then try again.');
        return;
      }
      // A single recording can contain a second voice or a noisy passage. If
      // the per-chunk embeddings disagree, the profile would reject the real
      // user later; ask for a clean retry instead.
      for (let left = 0; left < embeddings.length; left++) {
        for (let right = left + 1; right < embeddings.length; right++) {
          if (cosineSimilarity(embeddings[left], embeddings[right]) < 0.35) {
            recordVoiceDiagnostic('blocked', { source: 'enrollment', phase: 'sample', reason: 'noisy-sample' });
            setStatus('error');
            setError(i18n.t('settings:voice.localWake.enrollmentNoisy'));
            return;
          }
        }
      }
      const embedding = averageEmbeddings(embeddings);
      if (!embedding) {
        throw new Error('Could not build a voice profile from that sample.');
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      phaseRef.current = 'save';
      setStatus('committing');
      await saveLocalSpeakerProfile(embedding);
      if (!mountedRef.current || generation !== generationRef.current) return;
      setHasProfile(true);
      setStatus('idle');
      setError(undefined);
    } catch (enrollmentError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setStatus('error');
      const phase = phaseRef.current;
      recordVoiceDiagnostic('failed', { source: 'enrollment', phase, reason: phase === 'save' ? 'profile-save-rejected' : 'embedding-rejected' });
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Could not enroll this voice.');
    } finally {
      if (generation === generationRef.current) attemptAtRef.current = undefined;
    }
  }, [stopCapture]);
  useEffect(() => {
    finishRef.current = () => { void finishEnrollment(); };
  }, [finishEnrollment]);

  const enroll = useCallback(async (stopTest?: () => Promise<void>) => {
    if (Platform.OS === 'web') {
      setStatus('error');
      setError('Voice enrollment is not supported on web.');
      return;
    }
    if (AppState.currentState === 'background' || attemptAtRef.current !== undefined || startingRef.current) {
      return;
    }
    const generation = ++generationRef.current;
    startingRef.current = true;
    setError(undefined);
    setStatus('starting');
    const startedAt = Date.now();
    attemptAtRef.current = startedAt;
    firstFrameRef.current = false;
    chunksRef.current = [];
    resamplerRef.current = createResampler(SAMPLE_RATE, SAMPLE_RATE);
    resamplerRateRef.current = SAMPLE_RATE;
    phaseRef.current = 'preflight';
    try {
      if (stopTest) await stopTest();
      if (!mountedRef.current || generation !== generationRef.current) return;
      phaseRef.current = 'model';
      await ensureLocalSpeakerRuntime();
      if (!mountedRef.current || generation !== generationRef.current) return;
      phaseRef.current = 'permission';
      const permission = await ensureLocalVoicePermissionAsync();
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (!permission.granted) {
        recordVoiceDiagnostic('blocked', { source: 'enrollment', phase: 'permission', reason: 'permission-denied' });
        attemptAtRef.current = undefined;
        setStatus('error');
        setError('Microphone permission is required to enroll your voice.');
        return;
      }
      phaseRef.current = 'audio-session';
      audioOwnedRef.current = true;
      await activateLocalWakeRecordingAsync();
      if (!mountedRef.current || generation !== generationRef.current) {
        if (audioOwnedRef.current) await stopCapture();
        return;
      }
      phaseRef.current = 'stream';
      recordingRef.current = true;
      await stream.start();
      if (!mountedRef.current || generation !== generationRef.current) {
        await stopCapture();
        return;
      }
      if (!firstFrameRef.current) {
        firstFrameTimerRef.current = setTimeout(() => {
          if (generation !== generationRef.current) return;
          void stopCapture().then(() => {
            if (!mountedRef.current || generation !== generationRef.current) return;
            attemptAtRef.current = undefined;
            recordVoiceDiagnostic('failed', {
              source: 'enrollment', phase: 'stream', reason: 'first-frame-timeout', durationMs: Date.now() - startedAt,
            });
            setStatus('error');
            setError(i18n.t('settings:voice.localWake.microphoneStartFailed'));
          });
        }, FIRST_FRAME_TIMEOUT_MS);
      }
    } catch (startupError) {
      await stopCapture();
      if (!mountedRef.current || generation !== generationRef.current) return;
      attemptAtRef.current = undefined;
      const phase = phaseRef.current;
      recordVoiceDiagnostic('failed', {
        source: 'enrollment', phase, reason: 'startup-rejected',
        statusCode: audioCaptureErrorCode(startupError), durationMs: Date.now() - startedAt,
      });
      setStatus('error');
      setError(i18n.t(phase === 'stream' || phase === 'audio-session'
        ? 'settings:voice.localWake.microphoneStartFailed'
        : 'settings:voice.localWake.startFailed'));
    } finally {
      startingRef.current = false;
    }
  }, [stream, stopCapture]);

  const invalidate = useCallback((reason: VoiceCancellation) => {
    if (attemptAtRef.current !== undefined) {
      recordVoiceDiagnostic('cancelled', {
        source: 'enrollment', phase: phaseRef.current, reason, durationMs: Date.now() - attemptAtRef.current,
      });
    }
    attemptAtRef.current = undefined;
    chunksRef.current = [];
    return ++generationRef.current;
  }, []);
  const cancel = useCallback(async (reason: VoiceCancellation = 'user') => {
    // A profile write already in progress owns the completed sample.
    if (attemptAtRef.current !== undefined && phaseRef.current === 'save') return;
    const generation = invalidate(reason);
    await stopCapture();
    if (mountedRef.current && generation === generationRef.current) { setStatus('idle'); setError(undefined); }
  }, [invalidate, stopCapture]);

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
      if (phaseRef.current !== 'save') invalidate('screen-exit');
      void stopCapture();
    };
  }, [invalidate, stopCapture]);

  return {
    cancel,
    clearError: useCallback(() => setError(undefined), []),
    clearProfile,
    enroll,
    error,
    hasProfile,
    isRecording: status === 'recording',
    status,
  };
}
