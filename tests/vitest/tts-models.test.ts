import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

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

async function loadModels() {
  const catalog = await loadTs('lib/voice/tts/catalog.ts');
  const types = await loadTs('lib/voice/tts/types.ts');
  return loadTs('lib/voice/tts/models.ts', {
    'expo-file-system': fakeFileSystem(),
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/voice/local-wake-word/sherpa': { loadSherpaRuntime: () => ({ TTS: {} }) },
    '@/lib/voice/model-files': { downloadVerified: async () => undefined },
    '@/lib/voice/tts/catalog': catalog,
    '@/lib/voice/tts/types': types,
  });
}

describe('on-device voice pack paths', () => {
  it('passes model files as names and directories as absolute paths', async () => {
    const models = await loadModels();
    const piper = models.getLocalTtsPackPaths('piper-en');

    assert.equal(piper.modelDir, 'file:///documents/opencode-tts/piper-en');
    assert.equal(piper.dataDir, 'file:///documents/opencode-tts/piper-en/espeak-ng-data');
    // The native sherpa-onnx config joins these names against modelDir. A
    // file:// URI here makes initialization look for a nested file: path.
    assert.equal(piper.modelFile, 'en_US-amy-medium.onnx');
    assert.equal(piper.tokensFile, 'tokens.txt');
    assert.equal(piper.lexiconFile, undefined);
    assert.equal(piper.voicesFile, undefined);

    const kokoro = models.getLocalTtsPackPaths('kokoro-en');
    assert.equal(kokoro.modelFile, 'model.int8.onnx');
    assert.equal(kokoro.tokensFile, 'tokens.txt');
    assert.equal(kokoro.voicesFile, 'voices.bin');

    const chinese = models.getLocalTtsPackPaths('piper-zh');
    assert.equal(chinese.lexiconFile, 'lexicon.txt');
  });
});
