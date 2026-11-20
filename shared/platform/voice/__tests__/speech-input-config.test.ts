import assert from 'node:assert/strict';
import { it } from 'vitest';
import { loadTs } from '../../../../tests/helpers/runtime.mjs';

it('follows the system locale when the setting is empty and keeps an explicit override', async () => {
  const { resolveSpeechInputLocale } = await loadTs('shared/platform/voice/speech-input-config.ts', {
    'expo-localization': { getLocales: () => [{ languageTag: 'de-DE' }] },
  });
  assert.equal(resolveSpeechInputLocale(), 'de-DE');
  assert.equal(resolveSpeechInputLocale('fr-FR'), 'fr-FR');
});

it('falls back to en-US when the device locale cannot be read', async () => {
  const { resolveSpeechInputLocale } = await loadTs('shared/platform/voice/speech-input-config.ts', {
    'expo-localization': {
      getLocales: () => {
        throw new Error('unavailable');
      },
    },
  });
  assert.equal(resolveSpeechInputLocale(), 'en-US');
});

it('keeps non-empty transcripts in recognizer order', async () => {
  const { resultTranscripts } = await loadTs('shared/platform/voice/speech-input-config.ts');
  assert.deepEqual(
    resultTranscripts([
      { transcript: ' hey code ', confidence: 0.5, segments: [] },
      { transcript: '', confidence: 0, segments: [] },
      { transcript: 'a code', confidence: 0.2, segments: [] },
    ]),
    ['hey code', 'a code'],
  );
});
