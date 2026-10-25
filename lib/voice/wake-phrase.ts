// Conversation-mode wake phrase handling.
//
// The phrase is a turn gate, not a recognition engine: the OS recognizer keeps
// streaming, but a turn only starts once the accumulated transcript contains
// the configured phrase. Matching stays deliberately literal (exact tokens or a
// single joined token) so noise cannot easily arm a turn; recognition recall is
// improved by passing the phrase to the recognizer as contextual vocabulary.

export const DEFAULT_WAKE_PHRASE = 'hey code';
export const MAX_WAKE_PHRASE_LENGTH = 60;

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
 * punctuation-insensitive. A multi-word phrase also matches when the recognizer
 * joins it into one token (`heycode`). Everything after the match is the
 * command; everything before it is discarded.
 */
export function findWakePhrase(text: string, phrase: string): WakePhraseMatch | undefined {
  const expected = phraseTokens(phrase);
  if (expected.length === 0) {
    return undefined;
  }

  const tokens = tokenize(text);
  if (expected.length > 1) {
    const joined = expected.join('');
    for (const token of tokens) {
      if (token.normalized === joined) {
        return {
          command: trimCommand(text.slice(token.end)),
          end: token.end,
          start: token.start,
        };
      }
    }
  }

  for (let index = 0; index + expected.length <= tokens.length; index++) {
    let matched = true;
    for (let offset = 0; offset < expected.length; offset++) {
      if (tokens[index + offset].normalized !== expected[offset]) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      continue;
    }

    const first = tokens[index];
    const last = tokens[index + expected.length - 1];
    return {
      command: trimCommand(text.slice(last.end)),
      end: last.end,
      start: first.start,
    };
  }

  return undefined;
}

export type WakePhraseSessionResult = {
  command: string;
  matched: boolean;
};

/**
 * Accumulates recognition results for one conversation turn.
 *
 * Interims are revisions of the active segment; finals commit it. Before a
 * phrase match only a short tail of the latest final is retained, so a phrase
 * split across segments still matches while arbitrary noise is discarded. Once
 * matched, the full text is kept and the command is recomputed as the suffix
 * after the first phrase occurrence, which keeps interim revisions from
 * duplicating or losing words.
 */
export function createWakePhraseSession(phrase: string) {
  const normalizedPhrase = normalizeWakePhrase(phrase);
  const expected = phraseTokens(normalizedPhrase);
  const tailTokenCount = Math.max(0, expected.length - 1);

  let committed = '';
  let current = '';
  let matched = false;
  let lastCommand = '';

  const fullText = () => current || committed;

  const retainTail = (value: string) => {
    if (tailTokenCount === 0) {
      return '';
    }
    const tokens = tokenize(value);
    if (tokens.length <= tailTokenCount) {
      return value.trim();
    }
    return value.slice(tokens[tokens.length - tailTokenCount].start).trim();
  };

  const evaluate = () => {
    const match = findWakePhrase(fullText(), normalizedPhrase);
    if (match) {
      matched = true;
      lastCommand = match.command;
      return;
    }
    // A revision can temporarily drop the phrase. Keep the last command rather
    // than flickering the turn back to unarmed; the command timeout recovers.
  };

  return {
    command() {
      return matched ? lastCommand.trim() : '';
    },
    matched() {
      return matched;
    },
    checkpoint() {
      if (current) {
        committed = current;
      }
      evaluate();
      return { command: matched ? lastCommand : '', matched } satisfies WakePhraseSessionResult;
    },
    push(transcript: string, isFinal: boolean): WakePhraseSessionResult {
      const segment = transcript.trim();
      if (!segment) {
        if (isFinal) {
          committed = current || committed;
        }
        return { command: matched ? lastCommand : '', matched };
      }

      current = committed ? `${committed} ${segment}` : segment;
      if (isFinal) {
        committed = current;
      }

      evaluate();

      if (!matched && isFinal) {
        const tail = retainTail(committed);
        committed = tail;
        current = tail;
      }

      return { command: matched ? lastCommand : '', matched };
    },
    reset() {
      committed = '';
      current = '';
      matched = false;
      lastCommand = '';
    },
    value() {
      return fullText() || undefined;
    },
  };
}
