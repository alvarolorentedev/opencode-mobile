import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

async function captureHarness() {
  const runtime = hookRuntime();
  let onBuffer: ((buffer: any) => void) | undefined;
  const stream = { start: vi.fn(async () => undefined), stop: vi.fn() };
  const vadResults: any[] = [];
  const recognized: Float32Array[] = [];
  const onCommand = vi.fn();
  const onNoCommand = vi.fn();
  const onError = vi.fn();
  const pcm = await loadTs('lib/voice/local-wake-word/pcm.ts');
  const similarity = await loadTs('lib/voice/local-wake-word/similarity.ts');
  const types = await loadTs('lib/voice/local-wake-word/types.ts');
  const { useLocalCommandCapture } = await loadTs('lib/voice/use-local-command-capture.ts', {
    react: runtime.react,
    'react-native': { Platform: { OS: 'android' } },
    'expo-audio': {
      useAudioStream: (options: any) => {
        onBuffer = options.onBuffer;
        return { stream, isStreaming: true };
      },
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
    },
    '@/lib/voice/local-wake-word/audio-session': {
      activateLocalWakeRecordingAsync: async () => undefined,
      deactivateLocalWakeRecordingAsync: async () => undefined,
    },
    '@/lib/voice/local-wake-word/pcm': pcm,
    '@/lib/voice/local-wake-word/runtime': {
      acceptVadSamples: async () => vadResults.shift() ?? { success: true, isSpeechDetected: false, segments: [] },
      computeLocalSpeakerEmbedding: async () => [1, 0],
      ensureLocalCommandRuntime: async () => undefined,
      recognizeLocalCommand: async (samples: Float32Array) => {
        recognized.push(samples);
        return 'open settings';
      },
      resetVad: async () => undefined,
    },
    '@/lib/voice/local-wake-word/similarity': similarity,
    '@/lib/voice/local-wake-word/speaker-profile': { loadLocalSpeakerProfile: async () => undefined },
    '@/lib/voice/local-wake-word/types': types,
  }, runtime.globals);

  runtime.mount(useLocalCommandCapture, {
    commandModel: 'moonshine-tiny-en',
    onCommand,
    onError,
    onNoCommand,
    onPartialCommand: () => undefined,
    phrase: 'hey-code',
    speakerThreshold: 0.5,
    verifySpeaker: false,
  });
  await runtime.settle();

  const start = async (samples?: Float32Array) => {
    const pending = runtime.value.start(samples);
    await runtime.settle();
    runtime.fire(80);
    await expect(pending).resolves.toBe(true);
    await runtime.settle();
  };
  const feed = (value = 1000, length = 160) => {
    const data = new Int16Array(length).fill(value);
    onBuffer?.({ data: data.buffer, sampleRate: 16000, channels: 1, timestamp: 0 });
  };
  return { runtime, stream, vadResults, recognized, onCommand, onNoCommand, onError, start, feed };
}

describe('local command capture handoff', () => {
  it('seeds VAD and ASR with audio captured during the wake handoff', async () => {
    const view = await captureHarness();
    const handoff = new Float32Array(6000).fill(0.2);
    view.vadResults.push(
      { success: true, isSpeechDetected: true, segments: [] },
      { success: true, isSpeechDetected: false, segments: [{ start: 0, duration: 0.1, startTime: 0, endTime: 0.1 }] },
    );
    await view.start(handoff);
    view.feed(1000);
    await view.runtime.settle();
    await view.runtime.settle();

    expect(view.recognized).toHaveLength(1);
    expect(view.recognized[0].length).toBeGreaterThan(6000);
    view.runtime.fire(1200);
    await view.runtime.settle();
    expect(view.onCommand).toHaveBeenCalledWith('open settings');
  });

  it('reschedules the no-speech timeout after discarding a too-short turn', async () => {
    const view = await captureHarness();
    view.vadResults.push(
      { success: true, isSpeechDetected: true, segments: [] },
      { success: true, isSpeechDetected: false, segments: [{ start: 0, duration: 0.1, startTime: 0, endTime: 0.1 }] },
    );
    await view.start(new Float32Array(400).fill(0.2));
    view.feed(1000, 80);
    await view.runtime.settle();
    await view.runtime.settle();

    expect(view.runtime.countTimers(6000)).toBeGreaterThan(0);
    view.runtime.fire(6000);
    await view.runtime.settle();
    expect(view.onNoCommand).toHaveBeenCalledOnce();
    expect(view.onCommand).not.toHaveBeenCalled();
  });
});
