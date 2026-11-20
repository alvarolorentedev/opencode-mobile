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
  let commandOnly = false;
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
    if (commandOnly) {
      lastCommand = fullText();
      return;
    }
    const match = findWakePhrase(fullText(), normalizedPhrase);
    if (match) {
      matched = true;
      lastCommand = match.command;
      return;
    }
    // A revision can temporarily drop the phrase. Keep the last command rather
    // than flickering the turn back to unarmed; the command timeout recovers.
  };

  const push = (transcript: string, isFinal: boolean): WakePhraseSessionResult => {
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
  };

  /**
   * Try the recognizer's alternative transcripts before committing the segment.
   * The top hypothesis is usually right, but a lower one often contains a phrase
   * the top misheard. Prefer an alternative that also carries a command so a
   * phrase-only top hypothesis does not drop the rest of the turn.
   */
  const pushAll = (transcripts: readonly string[], isFinal: boolean): WakePhraseSessionResult => {
    const candidates = transcripts.map((value) => value.trim()).filter(Boolean);
    if (candidates.length === 0) {
      return push('', isFinal);
    }
    if (matched || commandOnly || candidates.length === 1) {
      return push(candidates[0], isFinal);
    }

    let phraseOnly: string | undefined;
    for (const candidate of candidates) {
      const text = committed ? `${committed} ${candidate}` : candidate;
      const match = findWakePhrase(text, normalizedPhrase);
      if (!match) {
        continue;
      }
      if (match.command) {
        return push(candidate, isFinal);
      }
      phraseOnly ??= candidate;
    }

    return push(phraseOnly ?? candidates[0], isFinal);
  };

  return {
    command() {
      return matched ? lastCommand.trim() : '';
    },
    matched() {
      return matched;
    },
    /**
     * Mark this session as already woken. Used by the local wake-word path:
     * the OS recognizer starts after the on-device detector, so its transcript
     * is the whole command and must not be searched for the phrase again.
     */
    markMatched() {
      matched = true;
      commandOnly = true;
      lastCommand = fullText();
    },
    checkpoint() {
      if (current) {
        committed = current;
      }
      evaluate();
      if (!matched) {
        // Preserve only the short phrase tail across a recognition boundary so
        // a split phrase can still match without carrying a noisy buffer.
        const tail = retainTail(committed);
        committed = tail;
        current = tail;
      }
      return { command: matched ? lastCommand : '', matched } satisfies WakePhraseSessionResult;
    },
    push,
    pushAll,
    reset() {
      committed = '';
      current = '';
      matched = false;
      commandOnly = false;
      lastCommand = '';
    },
    value() {
      return fullText() || undefined;
    },
  };
}
