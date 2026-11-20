// Conversation-mode wake phrase handling.
//
// The phrase is a turn gate, not a recognition engine: the OS recognizer keeps
// streaming, but a turn only starts once the accumulated transcript contains
// the configured phrase. Matching stays deliberately literal (exact tokens or
// tokens that join into the phrase) so noise cannot easily arm a turn;
// recognition recall is improved by passing the phrase to the recognizer as
// contextual vocabulary and by checking its alternative transcripts.

export const DEFAULT_WAKE_PHRASE = 'hey code';
export const MAX_WAKE_PHRASE_LENGTH = 60;
const PREFIX_TIMEOUT_MS = 6000;

// Unicode letters and numbers are words. Everything else is a separator, so
// paths, flags and shell punctuation in the command survive untouched.
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
// Separators allowed immediately after the phrase before the command begins.
// Slashes, hashes, dashes and other command-leading symbols are preserved.
const LEADING_SEPARATORS = /^[\s,.;:!?…"'“”‘’]+/u;

type Token = {
  end: number;
  normalized: string;
  start: number;
};

function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  for (const match of value.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    tokens.push({
      end: start + match[0].length,
      normalized: match[0].toLocaleLowerCase(),
      start,
    });
  }
  return tokens;
}

function phraseTokens(phrase: string) {
  return tokenize(phrase).map((token) => token.normalized);
}

/**
 * Normalize a configured phrase for display and matching. Empty, whitespace or
 * punctuation-only values fall back to the default so conversation mode always
 * has a usable gate.
 */
export function normalizeWakePhrase(value: string | undefined): string {
  const candidate = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_WAKE_PHRASE_LENGTH).trim();
  return phraseTokens(candidate).length > 0 ? candidate : DEFAULT_WAKE_PHRASE;
}

function trimCommand(value: string) {
  return value.replace(LEADING_SEPARATORS, '').trim();
}

export type WakePhraseMatch = {
  command: string;
  end: number;
  start: number;
};

/**
 * Find the first phrase occurrence in `text`. Matching is case- and
 * punctuation-insensitive. A phrase also matches when the recognizer joins it
 * into one token (`heycode`) or splits it across tokens (`hey open code` for
 * `hey opencode`). Everything after the match is the command; everything before
 * it is discarded.
 */
export function findWakePhrase(text: string, phrase: string): WakePhraseMatch | undefined {
  const expected = phraseTokens(phrase);
  if (expected.length === 0) {
    return undefined;
  }

  const tokens = tokenize(text);
  const joined = expected.join('');
  for (let index = 0; index < tokens.length; index++) {
    if (index + expected.length <= tokens.length) {
      let matched = true;
      for (let offset = 0; offset < expected.length; offset++) {
        if (tokens[index + offset].normalized !== expected[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        const first = tokens[index];
        const last = tokens[index + expected.length - 1];
        return {
          command: trimCommand(text.slice(last.end)),
          end: last.end,
          start: first.start,
        };
      }
    }

    // A joined phrase can be split across several tokens ("hey open code" for
    // "hey opencode"), not only collapsed into one ("heycode").
    let value = '';
    for (let end = index; end < tokens.length; end++) {
      value += tokens[end].normalized;
      if (value === joined) {
        return {
          command: trimCommand(text.slice(tokens[end].end)),
          end: tokens[end].end,
          start: tokens[index].start,
        };
      }
      if (value.length >= joined.length) {
        break;
      }
    }
  }

  return undefined;
}

export type WakePhraseSessionResult = {
  command: string;
  matched: boolean;
};

/**
 * Interims replace the active segment. Until the wake segment settles, keep
 * checking alternatives so the command is revised with the wake hypothesis.
 */
export function createWakePhraseSession(phrase: string) {
  const normalizedPhrase = normalizeWakePhrase(phrase);
  const expected = phraseTokens(normalizedPhrase).join('');

  type Prefix = { text: string; expiresAt: number };
  let prefixes = new Map<string, Prefix>();
  let pendingPrefixes: typeof prefixes | undefined;
  let committed = '';
  let current = '';
  let matched = false;
  let commandOnly = false;

  const fullText = () => current || committed;
  const command = () => commandOnly ? fullText() : findWakePhrase(fullText(), normalizedPhrase)?.command ?? '';
  const result = (): WakePhraseSessionResult => ({ command: matched ? command() : '', matched });

  const checkpoint = () => {
    if (matched) {
      committed = fullText();
    } else if (pendingPrefixes) {
      prefixes = pendingPrefixes;
    }
    pendingPrefixes = undefined;
    current = '';
    return result();
  };

  const pushAll = (transcripts: readonly string[], isFinal: boolean): WakePhraseSessionResult => {
    const candidates = transcripts.map((value) => value.trim()).filter(Boolean);
    if (!candidates.length) {
      return isFinal ? checkpoint() : result();
    }
    if (commandOnly || committed) {
      current = committed ? `${committed} ${candidates[0]}` : candidates[0];
      return isFinal ? checkpoint() : result();
    }

    const now = Date.now();
    const activePrefixes = [...prefixes.values()].filter((prefix) => prefix.expiresAt > now);
    const nextPrefixes = new Map<string, Prefix>();
    let phraseOnly: string | undefined;
    for (const candidate of candidates) {
      const segments = [
        { text: candidate, expiresAt: now + PREFIX_TIMEOUT_MS },
        ...activePrefixes.map((prefix) => ({ ...prefix, text: `${prefix.text} ${candidate}` })),
      ];
      for (const { text, expiresAt } of segments) {
        const match = findWakePhrase(text, normalizedPhrase);
        if (match?.command) {
          matched = true;
          current = text;
          return isFinal ? checkpoint() : result();
        }
        if (match) {
          phraseOnly ??= text;
          continue;
        }
        const tokens = tokenize(text);
        let suffix = '';
        for (let index = tokens.length - 1; index >= 0; index--) {
          suffix = tokens[index].normalized + suffix;
          if (suffix.length >= expected.length) break;
          if (expected.startsWith(suffix)) {
            const previous = nextPrefixes.get(suffix);
            if (!previous || expiresAt > previous.expiresAt) {
              nextPrefixes.set(suffix, { text: text.slice(tokens[index].start), expiresAt });
            }
          }
        }
      }
    }

    if (phraseOnly) {
      matched = true;
      current = phraseOnly;
    }
    pendingPrefixes = nextPrefixes;
    return isFinal ? checkpoint() : result();
  };

  return {
    command() {
      return matched ? command() : '';
    },
    matched() {
      return matched;
    },
    markMatched() {
      matched = true;
      commandOnly = true;
    },
    checkpoint,
    push: (transcript: string, isFinal: boolean) => pushAll([transcript], isFinal),
    pushAll,
    reset() {
      prefixes.clear();
      pendingPrefixes = undefined;
      committed = '';
      current = '';
      matched = false;
      commandOnly = false;
    },
    value() {
      return fullText() || undefined;
    },
  };
}
