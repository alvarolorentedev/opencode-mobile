import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import * as speech from '@/shared/platform/voice/system-tts';

const { getAvailableVoicesAsync } = vi.hoisted(() => ({ getAvailableVoicesAsync: vi.fn() }));
vi.mock('expo-speech', () => ({ getAvailableVoicesAsync, speak: () => {}, stop: async () => {} }));

describe('system speech voice selection', () => {
  it('prefers enhanced voices in the requested locale and falls back when a saved voice disappears', async () => {
    const voices = [
      { identifier: 'es-default', name: 'Spanish Default', language: 'es-ES', quality: 'Default' },
      { identifier: 'es-enhanced', name: 'Spanish Enhanced', language: 'es-ES', quality: 'Enhanced' },
      { identifier: 'en-enhanced', name: 'English Enhanced', language: 'en-US', quality: 'Enhanced' },
    ];
    getAvailableVoicesAsync.mockResolvedValue(voices);

    const options = await speech.getSpeechVoiceOptions();
    assert.deepEqual(
      JSON.parse(JSON.stringify(options.map((voice: any) => [voice.id, voice.quality]))),
      [['en-enhanced', 'enhanced'], ['es-default', 'default'], ['es-enhanced', 'enhanced']],
    );
    assert.equal(await speech.resolveSpeechVoice(undefined, 'es-ES'), 'es-enhanced');
    assert.equal(await speech.resolveSpeechVoice('missing', 'es-ES'), 'es-enhanced');
    assert.equal(await speech.resolveSpeechVoice('en-enhanced', 'es-ES'), 'en-enhanced');
  });
});
