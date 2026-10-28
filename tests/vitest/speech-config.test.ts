import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

describe('speech playback selection', () => {
  it('uses the system engine unless a local pack is explicitly selected', async () => {
    const { getSpeechPlayback } = await loadTs('lib/voice/speech-config.ts');

    assert.deepEqual(
      JSON.parse(JSON.stringify(getSpeechPlayback({ speechVoiceId: 'voice-1' }))),
      { engine: 'system', voice: 'voice-1' },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(getSpeechPlayback({ ttsEngine: 'local', localTtsPackId: 'piper-es', localTtsSpeakerId: 2.9 }))),
      { engine: 'local', packId: 'piper-es', speakerId: 2 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(getSpeechPlayback({ ttsEngine: 'local', localTtsPackId: 'piper-es', localTtsSpeakerId: -1 }))),
      { engine: 'local', packId: 'piper-es', speakerId: 0 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(getSpeechPlayback({ ttsEngine: 'local' }))),
      { engine: 'system' },
    );
  });
});
