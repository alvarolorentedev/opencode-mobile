import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WAKE_PHRASE,
  MAX_WAKE_PHRASE_LENGTH,
  createWakePhraseSession,
  findWakePhrase,
  normalizeWakePhrase,
} from '@/shared/platform/voice/wake-phrase';

describe('wake phrase normalization', () => {
  it('falls back to the default for empty, whitespace and punctuation-only values', () => {
    expect(normalizeWakePhrase(undefined)).toBe(DEFAULT_WAKE_PHRASE);
    expect(normalizeWakePhrase('')).toBe(DEFAULT_WAKE_PHRASE);
    expect(normalizeWakePhrase('   ')).toBe(DEFAULT_WAKE_PHRASE);
    expect(normalizeWakePhrase(' !!! ')).toBe(DEFAULT_WAKE_PHRASE);
  });

  it('collapses whitespace, keeps casing and caps length', () => {
    expect(normalizeWakePhrase('  Hey    Code  ')).toBe('Hey Code');
    const long = normalizeWakePhrase('a'.repeat(MAX_WAKE_PHRASE_LENGTH + 20));
    expect(long).toHaveLength(MAX_WAKE_PHRASE_LENGTH);
  });
});

describe('wake phrase matching', () => {
  it('matches case, punctuation and joined variants', () => {
    expect(findWakePhrase('Hey, Code! open settings', 'hey code')?.command).toBe('open settings');
    expect(findWakePhrase('heycode open settings', 'hey code')?.command).toBe('open settings');
    expect(findWakePhrase('HEY CODE', 'Hey Code')?.command).toBe('');
  });

  it('returns the suffix after the first occurrence and preserves command casing', () => {
    expect(findWakePhrase('noise hey code please fix useEffect', 'hey code')?.command).toBe('please fix useEffect');
    expect(findWakePhrase('hey code, please fix the build', 'hey code')?.command).toBe('please fix the build');
  });

  it('does not match inside a larger word or with different tokens', () => {
    expect(findWakePhrase('hey coder fix this', 'hey code')).toBeUndefined();
    expect(findWakePhrase('they code fix this', 'hey code')).toBeUndefined();
    expect(findWakePhrase('heycodex fix this', 'hey code')).toBeUndefined();
  });

  it('supports non-Latin phrases', () => {
    expect(findWakePhrase('Привет код открой настройки', 'привет код')?.command).toBe('открой настройки');
  });

  it('preserves command-leading paths, hashes and flags', () => {
    expect(findWakePhrase('hey code /help', 'hey code')?.command).toBe('/help');
    expect(findWakePhrase('hey code #123', 'hey code')?.command).toBe('#123');
    expect(findWakePhrase('hey code -v', 'hey code')?.command).toBe('-v');
  });
});

describe('wake phrase session', () => {
  it('matches a phrase split across final segments', () => {
    const session = createWakePhraseSession('hey code');
    expect(session.push('hey', true)).toEqual({ command: '', matched: false });
    expect(session.push('code open settings', true)).toEqual({ command: 'open settings', matched: true });
    expect(session.command()).toBe('open settings');
  });

  it('keeps a phrase split across an interim', () => {
    const session = createWakePhraseSession('hey code');
    session.push('hey', true);
    expect(session.push('co', false).matched).toBe(false);
    expect(session.push('code open', false)).toEqual({ command: 'open', matched: true });
  });

  it('discards noise before the phrase and keeps only a short tail', () => {
    const session = createWakePhraseSession('hey code');
    expect(session.push('thank you very much', true).matched).toBe(false);
    expect(session.push('hey code run tests', true)).toEqual({ command: 'run tests', matched: true });
  });

  it('recomputes the command across interim revisions', () => {
    const session = createWakePhraseSession('hey code');
    expect(session.push('hey code open', false)).toEqual({ command: 'open', matched: true });
    expect(session.push('hey code open settings', false)).toEqual({ command: 'open settings', matched: true });
    expect(session.push('hey code open settings', true)).toEqual({ command: 'open settings', matched: true });
    expect(session.push('now', true)).toEqual({ command: 'open settings now', matched: true });
  });

  it('matches a phrase-only turn and exposes no command', () => {
    const session = createWakePhraseSession('hey code');
    expect(session.push('hey code', true)).toEqual({ command: '', matched: true });
    expect(session.command()).toBe('');
  });

  it('resets between turns', () => {
    const session = createWakePhraseSession('hey code');
    session.push('hey code first', true);
    session.reset();
    expect(session.push('second', true)).toEqual({ command: '', matched: false });
    expect(session.push('hey code second', true)).toEqual({ command: 'second', matched: true });
  });

  it('checkpoints an unfinished command at a recognition boundary', () => {
    const session = createWakePhraseSession('hey code');
    session.push('hey code open', false);
    expect(session.checkpoint().command).toBe('open');
    expect(session.push('settings', true).command).toBe('open settings');
  });

  it('preserves the phrase tail across an unmatched checkpoint', () => {
    const session = createWakePhraseSession('hey code');
    session.push('hey', true);
    expect(session.checkpoint()).toEqual({ command: '', matched: false });
    expect(session.push('code open settings', true)).toEqual({ command: 'open settings', matched: true });
  });

  it('treats all following text as the command after a local wake-word match', () => {
    const session = createWakePhraseSession('hey code');
    session.markMatched();
    expect(session.push('open settings', false)).toEqual({ command: 'open settings', matched: true });
    expect(session.push('open settings now', true)).toEqual({ command: 'open settings now', matched: true });
    expect(session.command()).toBe('open settings now');
    session.reset();
    expect(session.push('plain text', true)).toEqual({ command: '', matched: false });
  });
});
