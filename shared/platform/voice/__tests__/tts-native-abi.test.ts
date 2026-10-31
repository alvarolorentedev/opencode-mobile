import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

// The 1.3.1 Android package ships the sherpa-onnx 1.13.0 JNI library but its
// bundled Kotlin config classes were missing the zipvoice/supertonic fields.
// initTts then aborts the process with a NoSuchFieldError before any model
// loads, so previewing or playing an on-device voice crashes the app.
describe('sherpa-onnx Android TTS JNI config', () => {
  const source = readFileSync(
    'node_modules/@siteed/sherpa-onnx.rn/android/src/main/kotlin/com/k2fsa/sherpa/onnx/Tts.kt',
    'utf8',
  );

  it('declares the zipvoice and supertonic config classes required by the JNI', () => {
    assert.match(source, /data class OfflineTtsZipVoiceModelConfig\(/);
    assert.match(source, /data class OfflineTtsSupertonicModelConfig\(/);
  });

  it('keeps the OfflineTtsModelConfig fields in the order the JNI expects', () => {
    const start = source.indexOf('data class OfflineTtsModelConfig(');
    assert.notEqual(start, -1);
    const modelConfig = source.slice(start, source.indexOf('\n)', start));
    const fields = ['vits', 'matcha', 'kokoro', 'zipvoice', 'kitten', 'pocket', 'supertonic', 'numThreads', 'debug', 'provider'];
    let cursor = -1;
    for (const field of fields) {
      const next = modelConfig.indexOf(`var ${field}:`, cursor + 1);
      assert.ok(next > cursor, `${field} is missing or out of order`);
      cursor = next;
    }
  });

  it('ships the fix through the patch-package entry', () => {
    const patch = readFileSync('patches/@siteed+sherpa-onnx.rn+1.3.1.patch', 'utf8');
    assert.match(patch, /OfflineTtsZipVoiceModelConfig/);
    assert.match(patch, /OfflineTtsSupertonicModelConfig/);
  });
});
