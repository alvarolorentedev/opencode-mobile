import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { resolveSpeechInputLocale, resultTranscripts } from '@/shared/platform/voice/speech-input-config';

const { getLocales } = vi.hoisted(() => ({ getLocales: vi.fn() }));
vi.mock('expo-localization', () => ({ getLocales }));

it('follows the system locale when the setting is empty and keeps an explicit override', async () => {
  getLocales.mockReturnValue([{ languageTag: 'de-DE' }]);
  assert.equal(resolveSpeechInputLocale(), 'de-DE');
  assert.equal(resolveSpeechInputLocale('fr-FR'), 'fr-FR');
});

it('falls back to en-US when the device locale cannot be read', async () => {
  getLocales.mockImplementation(() => { throw new Error('unavailable'); });
  assert.equal(resolveSpeechInputLocale(), 'en-US');
});

it('keeps non-empty transcripts in recognizer order', async () => {
  assert.deepEqual(
    resultTranscripts([
      { transcript: ' hey code ', confidence: 0.5, segments: [] },
      { transcript: '', confidence: 0, segments: [] },
      { transcript: 'a code', confidence: 0.2, segments: [] },
    ]),
    ['hey code', 'a code'],
  );
});
