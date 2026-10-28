import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

async function loadEngine({
  generate = async (index: number) => `/tmp/opencode-tts-${index}.wav`,
  play = async (_file: string, _signal: AbortSignal, onStarted?: () => void) => { onStarted?.(); },
}: {
  generate?: (index: number) => Promise<string>;
  play?: (file: string, signal: AbortSignal, onStarted?: () => void) => Promise<void>;
} = {}) {
  const catalog = await loadTs('lib/voice/tts/catalog.ts');
  const types = await loadTs('lib/voice/tts/types.ts');
  const deleted: string[] = [];
  let nextIndex = 0;
  const engine = await loadTs('lib/voice/tts/engine.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/voice/tts/catalog': catalog,
    '@/lib/voice/tts/models': { getLocalTtsPackStatus: () => 'ready' },
    '@/lib/voice/tts/runtime': {
      ensureLocalTtsRuntime: async () => undefined,
      generateLocalTtsChunk: async () => generate(nextIndex++),
      scheduleLocalTtsRelease: () => {},
    },
    '@/lib/voice/tts/player': {
      deleteLocalTtsFile: (file: string) => { deleted.push(file); },
      playLocalTtsFile: play,
    },
    '@/lib/voice/tts/types': types,
  });
  return { engine, deleted };
}

describe('local speech playback', () => {
  it('plays every chunk, reports completion once, and deletes temp files', async () => {
    const { engine, deleted } = await loadEngine();
    const controller = new AbortController();
    let done = 0;
    let started = 0;
    const result = engine.speakLocalText({
      chunks: ['first', 'second'],
      language: 'en-US',
      onDone: () => { done += 1; },
      onError: () => assert.fail('unexpected error'),
      onStart: () => { started += 1; },
      packId: 'piper-en',
      signal: controller.signal,
      speakerId: 0,
    });

    assert.equal(await result, true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(started, 1);
    assert.equal(done, 1);
    assert.deepEqual(deleted, ['/tmp/opencode-tts-0.wav', '/tmp/opencode-tts-1.wav']);
  });

  it('resolves a pre-start cancellation without starting playback', async () => {
    let played = 0;
    const { engine } = await loadEngine({
      play: async () => { played += 1; },
    });
    const controller = new AbortController();
    controller.abort();
    let started = 0;
    const result = await engine.speakLocalText({
      chunks: ['first'],
      language: 'en-US',
      onDone: () => assert.fail('cancelled playback must not complete'),
      onError: () => assert.fail('cancelled playback must not error'),
      onStart: () => { started += 1; },
      packId: 'piper-en',
      signal: controller.signal,
      speakerId: 0,
    });
    assert.equal(result, false);
    assert.equal(started, 0);
    assert.equal(played, 0);
  });

  it('cancels mid-playback without hanging the start promise', async () => {
    const { engine } = await loadEngine({
      play: async (_file, signal, onStarted) => {
        onStarted?.();
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
          } else {
            signal.addEventListener('abort', () => resolve(), { once: true });
          }
        });
      },
    });
    const controller = new AbortController();
    let done = 0;
    const result = engine.speakLocalText({
      chunks: ['first'],
      language: 'en-US',
      onDone: () => { done += 1; },
      onError: () => assert.fail('cancelled playback must not error'),
      onStart: () => {},
      packId: 'piper-en',
      signal: controller.signal,
      speakerId: 0,
    });
    assert.equal(await result, true);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(done, 0);
  });
});
