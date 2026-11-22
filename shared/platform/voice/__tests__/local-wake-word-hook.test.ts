// @vitest-environment happy-dom

import { audioFixture } from '../../../../tests/helpers/local-audio-probe';
import { describe, expect, it, vi } from 'vitest';

import { useLocalWakeWord } from '@/shared/platform/voice/use-local-wake-word';
import { deferred, settleReact } from '../../../../tests/helpers/controlled-clock';
import { i18n } from '@/shared/i18n/index';
import { renderHook } from '../../../../tests/helpers/render-hook';

type WakeResult = { success: boolean; detected: boolean; keyword: string };

async function wakeWordHarness({
  profile = [1, 0],
  threshold = 0.5,
  verifySpeaker = true,
  ensureRuntime = async () => undefined,
  startStream = async () => undefined,
}: {
  profile?: number[];
  threshold?: number;
  verifySpeaker?: boolean;
  ensureRuntime?: () => Promise<unknown>;
  startStream?: () => Promise<unknown>;
} = {}) {
  const { clock, feed, native } = audioFixture();
  native.stream.start.mockImplementation(startStream);
  native.ensure.mockImplementation(ensureRuntime);
  native.profile.mockResolvedValue(profile);
  native.accept.mockResolvedValue({ success: true, detected: false, keyword: '' });
  const { accept, embedding, stream, deactivate } = native;
  const onWake = vi.fn(), onRejected = vi.fn(), onError = vi.fn();
  const runtime = renderHook(useLocalWakeWord, {
    commandModel: 'moonshine-tiny-en',
    onError,
    onRejected,
    onWake,
    phrase: 'hey-code',
    speakerThreshold: threshold,
    verifySpeaker,
  });
  await settleReact();
  const start = async () => {
    const starting = runtime.result.current.start();
    await settleReact();
    feed(0);
    expect(await starting, JSON.stringify(onError.mock.calls)).toBe(true);
    await settleReact();
    accept.mockClear();
  };
  return { runtime, clock, stream, accept, deactivate, embedding, onWake, onRejected, onError, feed, start };
}

describe('on-device wake word capture', () => {
  it('queues frames while KWS inference is in flight instead of dropping them', async () => {
    const view = await wakeWordHarness();
    await view.start();
    const first = deferred<WakeResult>();
    view.accept
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ success: true, detected: false, keyword: '' });

    view.feed(1000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    first.resolve({ success: true, detected: false, keyword: '' });
    await settleReact();

    expect(view.accept).toHaveBeenCalledTimes(2);
    expect(Array.from(view.accept.mock.calls[1][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
  });

  it('hands audio captured during the speaker check to command capture', async () => {
    const view = await wakeWordHarness();
    await view.start();

    const firstEmbedding = deferred<number[] | undefined>();
    view.embedding.mockImplementationOnce(() => firstEmbedding.promise);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await settleReact();

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    firstEmbedding.resolve([1, 0]);
    await settleReact();

    expect(view.onWake).toHaveBeenCalledOnce();
    expect(Array.from(view.onWake.mock.calls[0][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
    expect(view.stream.stop).toHaveBeenCalledOnce();
  });

  it('surfaces repeated native KWS failures instead of going silently deaf', async () => {
    const view = await wakeWordHarness();
    await view.start();

    view.accept.mockRejectedValue(new Error('native KWS failed'));
    view.feed(1000);
    await settleReact();
    view.feed(2000);
    await settleReact();
    view.feed(3000);
    await settleReact();

    expect(view.onError).toHaveBeenCalled();
    expect(view.onWake).not.toHaveBeenCalled();
    expect(view.stream.stop).toHaveBeenCalled();
  });

  it('keeps the detector live after a speaker rejection so an immediate retry is heard', async () => {
    const view = await wakeWordHarness();
    await view.start();

    view.embedding.mockResolvedValue([0, 1]);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await settleReact();

    expect(view.onRejected).toHaveBeenCalledOnce();
    expect(view.onWake).not.toHaveBeenCalled();
    expect(view.stream.stop).not.toHaveBeenCalled();
    expect(view.stream.start).toHaveBeenCalledOnce();

    view.embedding.mockResolvedValue([1, 0]);
    view.accept.mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });
    view.feed(1000);
    await settleReact();

    expect(view.onWake).toHaveBeenCalledOnce();
    expect(view.stream.stop).toHaveBeenCalledOnce();
    expect(view.stream.start).toHaveBeenCalledOnce();
  });

  it('drops a rejected phrase without discarding a retry already in flight', async () => {
    const view = await wakeWordHarness();
    await view.start();

    const firstEmbedding = deferred<number[] | undefined>();
    view.embedding
      .mockImplementationOnce(() => firstEmbedding.promise)
      .mockResolvedValue([1, 0]);
    view.accept
      .mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' })
      .mockResolvedValueOnce({ success: true, detected: true, keyword: '▁HE Y ▁CO DE' });

    view.feed(1000);
    await settleReact();
    expect(view.embedding).toHaveBeenCalledTimes(1);

    view.feed(2000);
    expect(view.accept).toHaveBeenCalledTimes(1);

    firstEmbedding.resolve([0, 1]);
    await settleReact();

    expect(view.onRejected).toHaveBeenCalledOnce();
    expect(view.embedding).toHaveBeenCalledTimes(2);
    expect(Array.from(view.embedding.mock.calls[1][0])).toEqual(
      new Array(160).fill(2000 / 32768),
    );
    expect(view.onWake).toHaveBeenCalledOnce();
  });

  it('waits for a valid frame and preserves a frame arriving before native start resolves', async () => {
    const nativeStart = deferred<void>();
    const view = await wakeWordHarness({ startStream: () => nativeStart.promise });
    const starting = view.runtime.result.current.start();
    await settleReact();
    view.feed(1000);
    expect(view.accept).not.toHaveBeenCalled();

    nativeStart.resolve();
    await expect(starting).resolves.toBe(true);
    await settleReact();

    expect(view.accept).toHaveBeenCalledOnce();
    expect(view.clock.countTimers(3000)).toBe(0);
  });

  it('releases the recorder and reports failure when native start produces no frames', async () => {
    const view = await wakeWordHarness();
    const starting = view.runtime.result.current.start();
    await settleReact();
    expect(view.clock.countTimers(3000)).toBe(1);
    view.feed(0, 0);
    await view.clock.advance(3000);

    await expect(starting).resolves.toBe(false);
    expect(view.stream.stop).toHaveBeenCalledOnce();
    expect(view.deactivate).toHaveBeenCalledOnce();
    expect(view.onError).toHaveBeenCalledWith(i18n.t('settings:voice.localWake.microphoneStartFailed'));
    expect(view.onWake).not.toHaveBeenCalled();
  });

  it('cancels the frame wait on stop and ignores late audio', async () => {
    const view = await wakeWordHarness();
    const starting = view.runtime.result.current.start();
    await settleReact();
    await view.runtime.result.current.stop();
    view.feed();
    await expect(starting).resolves.toBe(false);
    expect(view.clock.countTimers(3000)).toBe(0);
    expect(view.accept).not.toHaveBeenCalled();
    expect(view.onError).not.toHaveBeenCalled();
  });

  it('ignores a decoder failure that arrives after stop', async () => {
    const view = await wakeWordHarness();
    await view.start();
    const decode = deferred<WakeResult>();
    view.accept.mockImplementationOnce(() => decode.promise);
    view.feed();
    await view.runtime.result.current.stop();
    decode.reject(new Error('stale decode'));
    await settleReact();
    expect(view.onError).not.toHaveBeenCalled();
    expect(view.onWake).not.toHaveBeenCalled();
  });

  it('does not reopen the microphone when stop lands while start is still loading', async () => {
    const ensure = deferred<void>();
    const view = await wakeWordHarness({ ensureRuntime: () => ensure.promise });

    const starting = view.runtime.result.current.start();
    await settleReact();
    await view.runtime.result.current.stop();

    ensure.resolve();
    await expect(starting).resolves.toBe(false);
    await settleReact();

    expect(view.stream.start).not.toHaveBeenCalled();
  });
});
