import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import type { SherpaRuntime } from '@/shared/platform/voice/local-wake-word/types';

const { platform } = vi.hoisted(() => ({ platform: { foss: false } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { get foss() { return platform.foss; } } } } }));
vi.mock('expo-file-system', () => fakeFileSystem());
vi.mock('expo-crypto', () => ({}));
vi.mock('@/shared/platform/voice/local-wake-word/sherpa', () => ({ loadSherpaRuntime: () => ({ TTS: {} }) }));

function fakeFileSystem() {
  const join = (parent: string | { path: string }, name?: string) => {
    const base = typeof parent === 'string' ? parent : parent.path;
    return name === undefined ? base : `${base}/${name}`;
  };
  class Directory {
    path: string;
    constructor(parent: string | { path: string }, name?: string) {
      this.path = join(parent, name);
    }
    get uri() {
      return this.path.startsWith('file://') ? this.path : `file://${this.path}`;
    }
    get exists() {
      return true;
    }
  }
  class File {
    path: string;
    constructor(parent: string | { path: string }, name?: string) {
      this.path = join(parent, name);
    }
    get uri() {
      return this.path.startsWith('file://') ? this.path : `file://${this.path}`;
    }
    get exists() {
      return true;
    }
  }
  return { Directory, File, Paths: { document: '/documents', cache: '/cache' } };
}

describe('on-device voice pack paths', () => {
  it('passes model files as names and directories as absolute paths', async () => {
    const models = await import('@/shared/platform/voice/tts/models');
    const piper = models.getLocalTtsPackPaths('piper-en');
    assert.ok(piper);

    assert.equal(piper.modelDir, 'file:///documents/opencode-tts/piper-en');
    assert.equal(piper.dataDir, 'file:///documents/opencode-tts/piper-en/espeak-ng-data');
    // The native sherpa-onnx config joins these names against modelDir. A
    // file:// URI here makes initialization look for a nested file: path.
    assert.equal(piper.modelFile, 'en_US-amy-medium.onnx');
    assert.equal(piper.tokensFile, 'tokens.txt');
    assert.equal(piper.lexiconFile, undefined);
    assert.equal(piper.voicesFile, undefined);

    const kokoro = models.getLocalTtsPackPaths('kokoro-en');
    assert.ok(kokoro);
    assert.equal(kokoro.modelFile, 'model.int8.onnx');
    assert.equal(kokoro.tokensFile, 'tokens.txt');
    assert.equal(kokoro.voicesFile, 'voices.bin');

    const chinese = models.getLocalTtsPackPaths('piper-zh');
    assert.ok(chinese);
    assert.equal(chinese.lexiconFile, 'lexicon.txt');
  });
});

describe('native Sherpa availability', () => {
  it('does not load the excluded native module in FOSS builds', async () => {
    vi.resetModules();
    platform.foss = true;
    const sherpa = await import('@/shared/platform/voice/local-wake-word/sherpa.native');
    const load = vi.fn(() => assert.fail('FOSS must not load the native module.'));

    assert.equal(sherpa.loadSherpaRuntime(load), undefined);
    assert.equal(load.mock.calls.length, 0);
  });

  it('still loads the native module in non-FOSS builds', async () => {
    vi.resetModules();
    platform.foss = false;
    const runtime = { TTS: {} } as SherpaRuntime;
    const sherpa = await import('@/shared/platform/voice/local-wake-word/sherpa.native');

    assert.equal(sherpa.loadSherpaRuntime(() => runtime), runtime);
  });
});
