import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

describe('on-device voice runtime config', () => {
  it('sends both native config key aliases and plain filesystem paths', async () => {
    const calls: Record<string, unknown>[] = [];
    const native = {
      initTts: async (config: Record<string, unknown>) => {
        calls.push(config);
        return { success: true, sampleRate: 24000, numSpeakers: 11 };
      },
      generateTts: async (config: Record<string, unknown>) => {
        calls.push(config);
        return { success: true, filePath: '/cache/opencode-tts-kokoro-en.wav' };
      },
      stopTts: async () => ({ stopped: true }),
      releaseTts: async () => ({ released: true }),
    };
    const paths: Record<string, {
      modelDir: string;
      modelFile: string;
      tokensFile: string;
      dataDir?: string;
      voicesFile?: string;
      lexiconFile?: string;
    }> = {
      'kokoro-en': {
        modelDir: 'file:///documents/opencode-tts/kokoro-en',
        modelFile: 'model.int8.onnx',
        tokensFile: 'tokens.txt',
        dataDir: 'file:///documents/opencode-tts/kokoro-en/espeak-ng-data',
        voicesFile: 'voices.bin',
      },
      'piper-zh': {
        modelDir: 'file:///documents/opencode-tts/piper-zh',
        modelFile: 'zh_CN-xiao_ya-medium.onnx',
        tokensFile: 'tokens.txt',
        lexiconFile: 'lexicon.txt',
      },
    };
    const catalog = await loadTs('lib/voice/tts/catalog.ts');
    const types = await loadTs('lib/voice/tts/types.ts');
    const runtime = await loadTs('lib/voice/tts/runtime.ts', {
      'react-native': {
        TurboModuleRegistry: { get: (name: string) => (name === 'SherpaOnnx' ? native : null) },
      },
      '@/lib/voice/tts/catalog': catalog,
      '@/lib/voice/tts/models': { getLocalTtsPackPaths: (packId: string) => paths[packId] },
      '@/lib/voice/tts/types': types,
    });

    await runtime.ensureLocalTtsRuntime('kokoro-en');
    const kokoro = calls[0];
    // Android reads the ttsModelType/voicesFile names; the iOS bridge reads
    // modelType/voices, so both must be present.
    assert.equal(kokoro.modelType, 'kokoro');
    assert.equal(kokoro.ttsModelType, 'kokoro');
    assert.equal(kokoro.voices, 'voices.bin');
    assert.equal(kokoro.voicesFile, 'voices.bin');
    assert.equal(kokoro.modelDir, '/documents/opencode-tts/kokoro-en');
    assert.equal(kokoro.dataDir, '/documents/opencode-tts/kokoro-en/espeak-ng-data');
    assert.equal(kokoro.modelFile, 'model.int8.onnx');
    assert.equal(kokoro.tokensFile, 'tokens.txt');
    assert.equal(kokoro.lang, 'en');

    const file = await runtime.generateLocalTtsChunk('kokoro-en', 'hello', 99, 1.2);
    assert.equal(file, '/cache/opencode-tts-kokoro-en.wav');
    assert.equal(calls[1].speakerId, 10);

    await runtime.releaseLocalTtsRuntime();
    await runtime.ensureLocalTtsRuntime('piper-zh');
    const chinese = calls[2];
    assert.equal(chinese.modelType, 'vits');
    assert.equal(chinese.ttsModelType, 'vits');
    assert.equal(chinese.lexicon, 'lexicon.txt');
    assert.equal(chinese.lexiconFile, 'lexicon.txt');
    assert.equal(chinese.voices, undefined);
    assert.equal(chinese.dataDir, undefined);
    assert.equal(chinese.lang, 'zh');
  });
});
