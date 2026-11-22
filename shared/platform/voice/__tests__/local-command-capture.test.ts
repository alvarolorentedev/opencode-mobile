// @vitest-environment happy-dom

import { audioFixture } from '../../../../tests/helpers/local-audio-probe';
import { describe, expect, it, vi } from 'vitest';

import { useLocalCommandCapture } from '@/shared/platform/voice/use-local-command-capture';
import { settleReact } from '../../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../../tests/helpers/render-hook';

async function captureHarness() {
  const { clock, feed, native } = audioFixture();
  const vadResults: unknown[] = [];
  const recognized: Float32Array[] = [];
  native.accept.mockImplementation(async () => vadResults.shift() ?? { success: true, isSpeechDetected: false, segments: [] });
  native.recognize.mockImplementation(async (samples: Float32Array) => {
    recognized.push(samples);
    return 'open settings';
  });
  const onCommand = vi.fn(), onNoCommand = vi.fn(), onError = vi.fn();
  const runtime = renderHook(useLocalCommandCapture, {
    commandModel: 'moonshine-tiny-en',
    onCommand,
    onError,
    onNoCommand,
    onPartialCommand: () => undefined,
    phrase: 'hey-code',
    speakerThreshold: 0.5,
    verifySpeaker: false,
  });
  await settleReact();

  const start = async (samples?: Float32Array) => {
    const pending = runtime.result.current.start(samples);
    await settleReact();
    await clock.advance(80);
    await expect(pending).resolves.toBe(true);
    await settleReact();
  };
  return { clock, vadResults, recognized, onCommand, onNoCommand, onError, start, feed };
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
    await settleReact();
    await settleReact();

    expect(view.recognized).toHaveLength(1);
    expect(view.recognized[0].length).toBeGreaterThan(6000);
    await view.clock.advance(1200);
    await settleReact();
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
    await settleReact();
    await settleReact();

    expect(view.clock.countTimers(6000)).toBeGreaterThan(0);
    await view.clock.advance(6000);
    await settleReact();
    expect(view.onNoCommand).toHaveBeenCalledOnce();
    expect(view.onCommand).not.toHaveBeenCalled();
  });
});
