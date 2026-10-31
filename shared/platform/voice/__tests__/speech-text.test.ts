import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../../../../tests/helpers/runtime.mjs';

async function loadSpeechText() {
  const lexicon = await loadTs('shared/platform/voice/speech-lexicon.ts');
  return loadTs('shared/platform/voice/speech-text.ts', {
    '@/shared/platform/voice/speech-lexicon': lexicon
  });
}

describe('speech text preparation', () => {
  it('turns markdown into prose and keeps code/tables out of the readback', async () => {
    const { normalizeSpeechText } = await loadSpeechText();
    const text = [
      '# Heading',
      '',
      'Use **bold** and [the docs](https://example.com) with `npm test`.',
      '',
      '```ts',
      'const secret = 1;',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| API | 200 |',
      '',
      '- first item',
      '- second item',
    ].join('\n');

    const result = normalizeSpeechText(text);
    assert.match(result, /Heading/);
    assert.match(result, /Use bold and the docs with npm test/);
    assert.match(result, /Code block omitted/);
    assert.match(result, /Table omitted/);
    assert.match(result, /first item/);
    assert.doesNotMatch(result, /secret/);
    assert.doesNotMatch(result, /https:\/\//);
    assert.doesNotMatch(result, /```/);
  });

  it('expands developer terms and formats identifiers for the speaker', async () => {
    const { normalizeSpeechText } = await loadSpeechText();
    const result = normalizeSpeechText('Open /src/lib/voice/speech_output.ts and call getSpeechVoiceOptions with JSON.');
    assert.match(result, /Open source lib voice speech output dot T S/);
    assert.match(result, /get speech voice options/);
    assert.match(result, /J S O N/);
  });

  it('splits long text on paragraph and sentence boundaries', async () => {
    const { splitSpeechText } = await loadSpeechText();
    const paragraph = 'This is a sentence. '.repeat(60).trim();
    const chunks = splitSpeechText(`${paragraph}\n\nSecond paragraph.`, 200);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk: string) => chunk.length <= 200));
    assert.ok(chunks.every((chunk: string) => chunk.trim().length > 0));
    assert.equal(chunks.at(-1), 'Second paragraph.');
  });

  it('handles CJK punctuation and empty input', async () => {
    const { splitSpeechText, prepareSpeechText } = await loadSpeechText();
    const chunks = splitSpeechText('这是第一句。这是第二句！'.repeat(20), 80);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk: string) => chunk.length <= 80));
    assert.deepEqual(JSON.parse(JSON.stringify(prepareSpeechText('   '))), { text: '', chunks: [] });
    const spanish = prepareSpeechText('```ts\nconst value = 1;\n```', { language: 'es-ES' });
    assert.match(spanish.text, /Bloque de código omitido/);
  });
});
