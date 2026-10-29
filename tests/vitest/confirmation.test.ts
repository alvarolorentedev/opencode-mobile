import { describe, expect, it } from 'vitest';

import {
  classifyConfirmation,
  compactConfirmationCommand,
  confirmationContextualStrings,
  isLongConfirmationCommand,
  MAX_CONFIRMATION_READBACK_CHARS,
  normalizeConfirmationText,
} from '@/lib/voice/confirmation';
import { defaultChatPreferences } from '@/providers/opencode-preferences';

describe('voice confirmation grammar', () => {
  it('accepts clear affirmatives and rejects extra words', () => {
    expect(classifyConfirmation('Yes.', 'en-US')).toBe('yes');
    expect(classifyConfirmation('yes, send it', 'en-US')).toBe('ambiguous');
    expect(classifyConfirmation('yes but make it blue', 'en-US')).toBe('ambiguous');
    expect(classifyConfirmation('send it', 'en-US')).toBe('yes');
    expect(classifyConfirmation('No', 'en-US')).toBe('retry');
    expect(classifyConfirmation('edit', 'en-US')).toBe('edit');
    expect(classifyConfirmation('cancel', 'en-US')).toBe('cancel');
  });

  it('is enabled by default for new and migrated preferences', () => {
    expect(defaultChatPreferences.confirmVoiceCommands).toBe(true);
    expect(defaultChatPreferences.wakePhraseRequired).toBe(true);
  });

  it('supports the selected locale and an English fallback', () => {
    expect(classifyConfirmation('sí', 'es-ES')).toBe('yes');
    expect(classifyConfirmation('réessayer', 'fr-FR')).toBe('retry');
    expect(classifyConfirmation('はい', 'ja-JP')).toBe('yes');
    expect(classifyConfirmation('取消', 'zh-CN')).toBe('cancel');
    expect(classifyConfirmation('yes', 'es-ES')).toBe('yes');
  });

  it('treats empty and unknown finals as non-affirmative', () => {
    expect(classifyConfirmation('', 'en-US')).toBe('none');
    expect(classifyConfirmation('maybe later', 'en-US')).toBe('ambiguous');
  });

  it('normalizes punctuation and apostrophes without substring matching', () => {
    expect(normalizeConfirmationText('  That’s   right! ')).toBe('thats right');
    expect(classifyConfirmation('That’s right!', 'en-US')).toBe('yes');
    expect(classifyConfirmation('not yes', 'en-US')).toBe('ambiguous');
  });

  it('builds bounded contextual vocabulary and long-command policy', () => {
    const values = confirmationContextualStrings('en-US');
    expect(values).toContain('yes');
    expect(values).toContain('cancel');
    expect(values).toContain('yes');
    expect(isLongConfirmationCommand('a'.repeat(MAX_CONFIRMATION_READBACK_CHARS))).toBe(false);
    expect(isLongConfirmationCommand('a'.repeat(MAX_CONFIRMATION_READBACK_CHARS + 1))).toBe(true);
    expect(compactConfirmationCommand('  hello\n\nworld  ')).toBe('hello world');
  });
});
