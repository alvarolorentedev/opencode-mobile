// Token rules are shared by the native composer highlight and the transcript
// renderer. Keep the mention/command character classes in sync.

export type ComposerAccentRange = {
  type: 'bold' | 'mention-user' | 'mention-here';
  start: number;
  length: number;
};

export type TranscriptAccentSpan = {
  kind: 'mention' | 'command';
  start: number;
  length: number;
};

// The live markdown parser runs on the UI thread for every keystroke. Long
// pastes keep the plain text instead of paying for a full scan.
const MAX_HIGHLIGHT_LENGTH = 4000;

/**
 * Ranges for `react-native-live-markdown`. Mention styles only expose color and
 * background, so a separate bold range composes with the mention range.
 */
export function findComposerAccentRanges(text: string): ComposerAccentRange[] {
  'worklet';
  if (text.length > MAX_HIGHLIGHT_LENGTH) return [];

  // Create the patterns inside the worklet runtime; RegExp objects are not
  // captured across the worklet boundary.
  const commandPattern = /(^|\n)([ \t]*)(\/[\w.:-]*)/g;
  const mentionPattern = /(^|\s)(@[\w./-]*)/g;
  const ranges: ComposerAccentRange[] = [];
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(text)) !== null) {
    const token = match[3] ?? '';
    const start = match.index + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    ranges.push({ type: 'bold', start, length: token.length });
    ranges.push({ type: 'mention-here', start, length: token.length });
  }

  while ((match = mentionPattern.exec(text)) !== null) {
    const token = match[2] ?? '';
    const start = match.index + (match[1]?.length ?? 0);
    ranges.push({ type: 'bold', start, length: token.length });
    ranges.push({ type: 'mention-user', start, length: token.length });
  }

  return ranges;
}

// Mask code and existing links so tokens inside them are never wrapped. Simple
// regexes cover the renderer's common Markdown; unclosed fences are left as-is.
// shortcut: no full CommonMark tokenizer, upgrade if transcripts need nested or
// unclosed code/link coverage.
function maskMarkdown(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, blank)
    .replace(/`+[^`\n]*`+/g, blank)
    .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, blank);
}

function escapeLinkText(text: string): string {
  return text.replace(/[\\_]/g, '\\$&');
}

/** Spans of `@` mentions and leading `/` commands in transcript text. */
export function findTranscriptAccentSpans(text: string): TranscriptAccentSpan[] {
  const masked = maskMarkdown(text);
  const commandPattern = /(^|\n)([ \t]*)(\/[\w.:-]*)/g;
  const mentionPattern = /(^|\s)(@[\w./-]*)/g;
  const spans: TranscriptAccentSpan[] = [];
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(masked)) !== null) {
    const token = match[3] ?? '';
    const start = match.index + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    spans.push({ kind: 'command', start, length: token.length });
  }

  while ((match = mentionPattern.exec(masked)) !== null) {
    const token = match[2] ?? '';
    const start = match.index + (match[1]?.length ?? 0);
    spans.push({ kind: 'mention', start, length: token.length });
  }

  return spans.sort((left, right) => left.start - right.start);
}

/**
 * Wraps transcript tokens as links so the enriched markdown renderer can style
 * them through `linkVariants`. The URL is a constant: only the scheme matters.
 */
export function accentTranscriptMarkdown(text: string): string {
  const spans = findTranscriptAccentSpans(text);
  if (spans.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const span of spans) {
    const end = span.start + span.length;
    const token = escapeLinkText(text.slice(span.start, end));
    result += text.slice(cursor, span.start);
    result += `[${token}](${span.kind === 'command' ? 'command' : 'mention'}://x)`;
    cursor = end;
  }
  return result + text.slice(cursor);
}
