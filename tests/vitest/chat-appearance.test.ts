import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

// Migrated from the standalone tests/chat-appearance.test.mjs Node script.
describe('chat appearance preferences', () => {
  it('normalizes transcript font size and keeps flat/slim defaults off', async () => {
    const appearance = await loadTs('constants/appearance.ts');
    const { normalizeTranscriptFontSize, defaultChatPreferences } = await loadTs('providers/opencode-preferences.ts', {
      '@/constants/appearance': appearance,
      '@/lib/voice/wake-phrase': { DEFAULT_WAKE_PHRASE: 'hey code' },
      '@/lib/voice/local-wake-word/types': { DEFAULT_LOCAL_WAKE_PHRASE: 'hey-code', DEFAULT_LOCAL_COMMAND_MODEL: 'moonshine-tiny-en' },
    });

    assert.equal(normalizeTranscriptFontSize(16), 16);
    assert.equal(normalizeTranscriptFontSize(12.4), 12);
    assert.equal(normalizeTranscriptFontSize(11), 12);
    assert.equal(normalizeTranscriptFontSize(25), 24);
    assert.equal(normalizeTranscriptFontSize(Number.NaN), 16);
    assert.equal(normalizeTranscriptFontSize(undefined), 16);

    assert.equal(defaultChatPreferences.flatTranscript, false);
    assert.equal(defaultChatPreferences.slimInterface, false);
    assert.equal(defaultChatPreferences.themeMode, 'system');
    assert.equal(defaultChatPreferences.accentColor, 'green');
  });
});
