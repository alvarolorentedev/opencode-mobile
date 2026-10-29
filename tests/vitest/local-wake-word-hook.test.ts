import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

type WakeResult = { success: boolean; detected: boolean; keyword: string };

async function wakeWordHarness({
  profile = [1, 0],
  threshold = 0.5,
  verifySpeaker = true,
  ensureRuntime = async () => undefined,
}: {
  profile?: number[];
  threshold?: number;
  verifySpeaker?: boolean;
  ensureRuntime?: () => Promise<unknown>;
} = {}) {
  const runtime = hookRuntime();
  const stream = { start: vi.fn(async () => undefined), stop: vi.fn() };
  let onBuffer: ((buffer: any) => void) | undefined;
  const accept = vi.fn();
  const embedding = vi.fn();
  const onWake = vi.fn();
  const onRejected = vi.fn();
  const onError = vi.fn();
  const pcm = await loadTs('lib/voice/local-wake-word/pcm.ts');
  const similarity = await loadTs('lib/voice/local-wake-word/similarity.ts');
  const types = await loadTs('lib/voice/local-wake-word/types.ts');
  const { useLocalWakeWord } = await loadTs('lib/voice/use-local-wake-word.ts', {
    react: runtime.react,
    'react-native': { Platform: { OS: 'android' } },
    'expo-audio': {
      useAudioStream: (options: any) => {
        onBuffer = options.onBuffer;
        return { stream };
      },
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
    },
    '@/lib/voice/local-wake-word/audio-session': {
      activateLocalWakeRecordingAsync: async () => undefined,
      deactivateLocalWakeRecordingAsync: async () => undefined,
    },
    '@/lib/voice/local-wake-word/models': { getLocalVoiceModelStatus: () => 'ready' },
    '@/lib/voice/local-wake-word/pcm': pcm,
    '@/lib/voice/local-wake-word/runtime': {
      acceptWakeWordSamples: accept,
      computeLocalSpeakerEmbedding: embedding,
      ensureLocalCommandRuntime: async () => undefined,
      ensureLocalVoiceRuntime: ensureRuntime,
      resetWakeWordStream: async () => undefined,
    },
    '@/lib/voice/local-wake-word/similarity': similarity,
    '@/lib/voice/local-wake-word/speaker-profile': { loadLocalSpeakerProfile: async () => profile },
    '@/lib/voice/local-wake-word/types': types,
  }, runtime.globals);
  runtime.mount(useLocalWakeWord, {
    commandModel: 'moonshine-tiny-en',
    onError,
    onRejected,
    onWake,
    phrase: 'hey-code',
    speakerThreshold: threshold,
    verifySpeaker,
  });
  await runtime.settle();
  const feed = (value = 1000, length = 160) => {
    const samples = new Int16Array(length).fill(value);
    onBuffer?.({ data: samples.buffer, sampleRate: 16000, channels: 1, timestamp: 0 });
  };
  return { runtime, stream, accept, embedding, onWake, onRejected, onError, feed };
}

describe('on-device wake word capture', () => {
  it('queues frames while KWS inference is in flight instead of dropping them', async () => {
    const view = await wakeWordHarness();
    const first = deferred<WakeResult>();
    view.accept
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ success: true, detected: false, keyword: '' });

    await view.runtime.value.start();
    await view.runtime.settle();

    view.feed(1000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    first.resolve({ success: true, detected: false, keyword: '' });
    await view.runtime.settle();

    expect(view.accept).toHaveBeenCalledTimes(2);
    expect(Array.from(view.accept.mock.calls[1][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
  });

  it('hands audio captured during the speaker check to command capture', async () => {
    const view = await wakeWordHarness();
    await view.runtime.value.start();
    await view.runtime.settle();

    const firstEmbedding = deferred<number[] | undefined>();
    view.embedding.mockImplementationOnce(() => firstEmbedding.promise);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await view.runtime.settle();

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    firstEmbedding.resolve([1, 0]);
    await view.runtime.settle();

    expect(view.onWake).toHaveBeenCalledOnce();
    expect(Array.from(view.onWake.mock.calls[0][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
    expect(view.stream.stop).toHaveBeenCalledOnce();
  });

  it('surfaces repeated native KWS failures instead of going silently deaf', async () => {
    const view = await wakeWordHarness();
    await view.runtime.value.start();
    await view.runtime.settle();

    view.accept.mockRejectedValue(new Error('native KWS failed'));
    view.feed(1000);
    await view.runtime.settle();
    view.feed(2000);
    await view.runtime.settle();
    view.feed(3000);
    await view.runtime.settle();

    expect(view.onError).toHaveBeenCalled();
    expect(view.onWake).not.toHaveBeenCalled();
    expect(view.stream.stop).toHaveBeenCalled();
  });

  it('keeps the detector live after a speaker rejection so an immediate retry is heard', async () => {
    const view = await wakeWordHarness();
    await view.runtime.value.start();
    await view.runtime.settle();

    view.embedding.mockResolvedValue([0, 1]);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await view.runtime.settle();

    expect(view.onRejected).toHaveBeenCalledOnce();
    expect(view.onWake).not.toHaveBeenCalled();
    expect(view.stream.stop).not.toHaveBeenCalled();
    expect(view.stream.start).toHaveBeenCalledOnce();

    view.embedding.mockResolvedValue([1, 0]);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await view.runtime.settle();

    expect(view.onWake).toHaveBeenCalledOnce();
    expect(view.stream.stop).toHaveBeenCalledOnce();
    expect(view.stream.start).toHaveBeenCalledOnce();
  });

  it('drops a rejected phrase without discarding a retry already in flight', async () => {
    const view = await wakeWordHarness();
    await view.runtime.value.start();
    await view.runtime.settle();

    const firstEmbedding = deferred<number[] | undefined>();
    view.embedding
      .mockImplementationOnce(() => firstEmbedding.promise)
      .mockResolvedValue([1, 0]);
    view.accept
      .mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' })
      .mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });

    view.feed(1000);
    await view.runtime.settle();
    expect(view.embedding).toHaveBeenCalledTimes(1);

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    firstEmbedding.resolve([0, 1]);
    await view.runtime.settle();

    expect(view.onRejected).toHaveBeenCalledOnce();
    expect(view.embedding).toHaveBeenCalledTimes(2);
    expect(Array.from(view.embedding.mock.calls[1][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
    expect(view.onWake).toHaveBeenCalledOnce();
  });

  it('does not reopen the microphone when stop lands while start is still loading', async () => {
    const ensure = deferred<void>();
    const view = await wakeWordHarness({ ensureRuntime: () => ensure.promise });

    const starting = view.runtime.value.start();
    await view.runtime.settle();
    await view.runtime.value.stop();

    ensure.resolve();
    await expect(starting).resolves.toBe(false);
    await view.runtime.settle();

    expect(view.stream.start).not.toHaveBeenCalled();
  });
});
