import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../../../../tests/helpers/runtime.mjs';

async function enrollment(permission = Promise.resolve({ granted: true }), embedding = Promise.resolve([1, 0])) {
  const runtime = hookRuntime();
  const stream = { start: vi.fn(async () => undefined), stop: vi.fn() };
  const deactivate = vi.fn(async () => undefined);
  const save = vi.fn();
  const captureError = vi.fn();
  const info = vi.fn();
  let onBuffer: (buffer: any) => void = () => {};
  const { useLocalVoiceEnrollment } = await loadTs('shared/platform/voice/use-local-voice-enrollment.ts', {
    react: runtime.react,
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-audio': { useAudioStream: (options: any) => { onBuffer = options.onBuffer; return { stream }; } },
    '@/shared/platform/voice/permissions': { ensureLocalVoicePermissionAsync: () => permission },
    "@/shared/i18n/index": { i18n: { t: (key: string) => key } },
    "@/shared/observability/client": { telemetry: { captureError, info } },
    "@/shared/platform/voice/local-wake-word/audio-session": { activateLocalWakeRecordingAsync: async () => undefined, deactivateLocalWakeRecordingAsync: deactivate },
    "@/shared/platform/voice/local-wake-word/pcm": { createResampler: () => ({ push: (samples: Float32Array) => samples }), int16ToFloat32: () => new Float32Array(64_000), selectSpeechSegment: (samples: Float32Array) => samples },
    "@/shared/platform/voice/local-wake-word/runtime": { ensureLocalSpeakerRuntime: async () => undefined, computeLocalSpeakerEmbedding: () => embedding },
    "@/shared/platform/voice/local-wake-word/similarity": { averageEmbeddings: vi.fn(), cosineSimilarity: () => 1 },
    "@/shared/platform/voice/local-wake-word/speaker-profile": { loadLocalSpeakerProfile: async () => [1, 0], saveLocalSpeakerProfile: save }
  }, runtime.globals);
  runtime.mount(useLocalVoiceEnrollment, {});
  await runtime.settle();
  return { runtime, stream, deactivate, save, captureError, info, feed: () => onBuffer({ data: new Int16Array([1]).buffer, sampleRate: 16000, channels: 1 }) };
}

describe('leaving voice setup', () => {
  it('does not start recording after leaving while microphone permission is pending', async () => {
    const permission = deferred<{ granted: boolean }>();
    const view = await enrollment(permission.promise);
    const pending = view.runtime.value.enroll();
    await view.runtime.settle();
    view.runtime.unmount();
    permission.resolve({ granted: true });
    await pending;
    expect(view.stream.start).not.toHaveBeenCalled();
    expect(view.runtime.countTimers(12_000)).toBe(0);
    expect(view.save).not.toHaveBeenCalled();
  });

  it('stops active capture and cancels the enrollment timer on leaving', async () => {
    const view = await enrollment();
    await view.runtime.value.enroll();
    expect(view.stream.start).toHaveBeenCalledOnce();
    await view.runtime.settle();
    expect(view.runtime.value.status).toBe('starting');
    expect(view.runtime.countTimers(12_000)).toBe(0);
    view.feed();
    await view.runtime.settle();
    expect(view.runtime.value.status).toBe('recording');
    expect(view.runtime.countTimers(3000)).toBe(0);
    expect(view.runtime.countTimers(12_000)).toBe(1);
    view.runtime.unmount();
    expect(view.stream.stop).toHaveBeenCalled();
    expect(view.deactivate).toHaveBeenCalled();
    expect(view.runtime.countTimers(12_000)).toBe(0);
    expect(view.save).not.toHaveBeenCalled();
  });
});

describe('cancel enrollment without unmounting Settings', () => {
  it('invalidates a pending permission request and keeps saved profiles untouched', async () => {
    const permission = deferred<{ granted: boolean }>();
    const view = await enrollment(permission.promise);
    const pending = view.runtime.value.enroll();
    await view.runtime.settle();
    await view.runtime.value.cancel();
    permission.resolve({ granted: true });
    await pending;
    view.runtime.flush();
    expect(view.runtime.value.status).toBe('idle');
    expect(view.stream.start).not.toHaveBeenCalled();
    expect(view.save).not.toHaveBeenCalled();
    expect(view.runtime.countTimers(12_000)).toBe(0);
  });
});

it('does not save a canceled voice profile after an embedding resolves', async () => {
  const embedding = deferred<number[]>();
  const view = await enrollment(Promise.resolve({ granted: true }), embedding.promise);
  await view.runtime.value.enroll();
  view.feed();
  view.runtime.fire(12_000);
  await view.runtime.settle();
  expect(view.runtime.value.status).toBe('saving');
  await view.runtime.value.cancel();
  embedding.resolve([1, 0]);
  await view.runtime.settle();
  expect(view.save).not.toHaveBeenCalled();
  expect(view.runtime.value.status).toBe('idle');
});

it('reports a rejected native start without its raw message and preserves the profile', async () => {
  const view = await enrollment();
  view.stream.start.mockRejectedValueOnce(Object.assign(new Error('private native payload'), { code: 'ERR_AUDIO_STREAM_INITIALIZATION' }));
  await view.runtime.value.enroll();
  await view.runtime.settle();
  expect(view.runtime.value.error).toBe('settings:voice.localWake.microphoneStartFailed');
  expect(view.runtime.value.hasProfile).toBe(true);
  expect(view.deactivate).toHaveBeenCalledOnce();
  expect(view.captureError).toHaveBeenCalledWith(
    { name: 'VoiceCaptureError', message: 'Voice enrollment failed' },
    expect.objectContaining({
      operation: 'voice.enrollment', phase: 'stream', reason: 'startup-rejected', statusCode: 'ERR_AUDIO_STREAM_INITIALIZATION',
    }),
    false,
  );
});

it('reports missing PCM and releases the recorder after three seconds', async () => {
  const view = await enrollment();
  await view.runtime.value.enroll();
  view.runtime.fire(3000);
  await view.runtime.settle();
  expect(view.runtime.value.status).toBe('error');
  expect(view.runtime.value.error).toBe('settings:voice.localWake.microphoneStartFailed');
  expect(view.stream.stop).toHaveBeenCalledOnce();
  expect(view.deactivate).toHaveBeenCalledOnce();
  expect(view.save).not.toHaveBeenCalled();
  expect(view.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'first-frame-timeout' }), false);
});

it('keeps a background cancellation local and ignores late frames', async () => {
  const view = await enrollment();
  await view.runtime.value.enroll();
  await view.runtime.value.cancel('background');
  view.feed();
  await view.runtime.settle();
  expect(view.runtime.value.status).toBe('idle');
  expect(view.runtime.countTimers(3000)).toBe(0);
  expect(view.runtime.countTimers(12_000)).toBe(0);
  expect(view.captureError).not.toHaveBeenCalled();
  expect(view.info).toHaveBeenCalledWith('voice.cancelled', expect.objectContaining({ reason: 'background' }));
});

it('does not start after the setup closes while the voice test is stopping', async () => {
  const view = await enrollment();
  const stoppingTest = deferred<void>();
  const starting = view.runtime.value.enroll(() => stoppingTest.promise);
  await view.runtime.value.cancel('screen-exit');
  stoppingTest.resolve(undefined);
  await starting;
  expect(view.stream.start).not.toHaveBeenCalled();
  expect(view.info).toHaveBeenCalledWith('voice.cancelled', expect.objectContaining({ phase: 'preflight', reason: 'screen-exit' }));
});
