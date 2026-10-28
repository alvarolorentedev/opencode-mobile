import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

async function enrollment(permission = Promise.resolve({ granted: true })) {
  const runtime = hookRuntime();
  const stream = { start: vi.fn(async () => undefined), stop: vi.fn() };
  const deactivate = vi.fn(async () => undefined);
  const save = vi.fn();
  const { useLocalVoiceEnrollment } = await loadTs('lib/voice/use-local-voice-enrollment.ts', {
    react: runtime.react,
    'react-native': { Platform: { OS: 'android' } },
    'expo-audio': { useAudioStream: () => ({ stream }), requestRecordingPermissionsAsync: () => permission },
    '@/lib/voice/local-wake-word/audio-session': { activateLocalWakeRecordingAsync: async () => undefined, deactivateLocalWakeRecordingAsync: deactivate },
    '@/lib/voice/local-wake-word/pcm': { createResampler: () => ({}), int16ToFloat32: vi.fn() },
    '@/lib/voice/local-wake-word/runtime': { ensureLocalSpeakerRuntime: async () => undefined, computeLocalSpeakerEmbedding: vi.fn() },
    '@/lib/voice/local-wake-word/similarity': { averageEmbeddings: vi.fn() },
    '@/lib/voice/local-wake-word/speaker-profile': { loadLocalSpeakerProfile: async () => undefined, saveLocalSpeakerProfile: save },
  }, runtime.globals);
  runtime.mount(useLocalVoiceEnrollment, {});
  await runtime.settle();
  return { runtime, stream, deactivate, save };
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
    expect(view.runtime.countTimers(12_000)).toBe(1);
    view.runtime.unmount();
    expect(view.stream.stop).toHaveBeenCalled();
    expect(view.deactivate).toHaveBeenCalled();
    expect(view.runtime.countTimers(12_000)).toBe(0);
    expect(view.save).not.toHaveBeenCalled();
  });
});
