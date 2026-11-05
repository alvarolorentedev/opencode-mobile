import { describe, expect, it } from 'vitest';

import {
  accentTranscriptMarkdown,
  findComposerAccentRanges,
  findTranscriptAccentSpans,
} from '@/features/chat/model/composer-accent';

describe('composer accent ranges', () => {
  it('marks mentions and leading commands for the live markdown input', () => {
    expect(findComposerAccentRanges('Review @src/foo.ts')).toEqual([
      { type: 'bold', start: 7, length: 11 },
      { type: 'mention-user', start: 7, length: 11 },
    ]);
    expect(findComposerAccentRanges('/review src')).toEqual([
      { type: 'bold', start: 0, length: 7 },
      { type: 'mention-here', start: 0, length: 7 },
    ]);
  });

  it('ignores emails and mid-line slashes', () => {
    expect(findComposerAccentRanges('user@example.com')).toEqual([]);
    expect(findComposerAccentRanges('and/or')).toEqual([]);
  });

  it('keeps bare triggers and commands after a newline', () => {
    expect(findComposerAccentRanges('@')).toEqual([
      { type: 'bold', start: 0, length: 1 },
      { type: 'mention-user', start: 0, length: 1 },
    ]);
    expect(findComposerAccentRanges('line\n/command')).toEqual([
      { type: 'bold', start: 5, length: 8 },
      { type: 'mention-here', start: 5, length: 8 },
    ]);
  });

  it('skips drafts above the highlight cap', () => {
    expect(findComposerAccentRanges(`@${'x'.repeat(4000)}`)).toEqual([]);
  });
});

describe('transcript accent spans', () => {
  it('finds mentions after whitespace and commands at line start', () => {
    expect(findTranscriptAccentSpans('Use @general and /review')).toEqual([
      { kind: 'mention', start: 4, length: 8 },
    ]);
    expect(findTranscriptAccentSpans('/review src\n@general')).toEqual([
      { kind: 'command', start: 0, length: 7 },
      { kind: 'mention', start: 12, length: 8 },
    ]);
  });

  it('leaves code spans, fenced blocks, and existing links alone', () => {
    expect(findTranscriptAccentSpans('`@code` @real')).toEqual([
      { kind: 'mention', start: 8, length: 5 },
    ]);
    expect(findTranscriptAccentSpans('```\n@code\n```\n@real')).toEqual([
      { kind: 'mention', start: 14, length: 5 },
    ]);
    expect(findTranscriptAccentSpans('[@link](https://x) @real')).toEqual([
      { kind: 'mention', start: 19, length: 5 },
    ]);
  });
});

describe('transcript markdown accents', () => {
  it('wraps mentions and line-start commands as styled links', () => {
    expect(accentTranscriptMarkdown('Use @general and /review')).toBe(
      'Use [@general](mention://x) and /review',
    );
    expect(accentTranscriptMarkdown('/review src')).toBe('[/review](command://x) src');
  });

  it('keeps code and links untouched and escapes underscores', () => {
    expect(accentTranscriptMarkdown('`@code` @real')).toBe('`@code` [@real](mention://x)');
    expect(accentTranscriptMarkdown('[@link](https://x) @real')).toBe(
      '[@link](https://x) [@real](mention://x)',
    );
    expect(accentTranscriptMarkdown('@foo_bar')).toBe('[@foo\\_bar](mention://x)');
  });

  it('leaves emails and mid-line slashes unchanged', () => {
    expect(accentTranscriptMarkdown('user@example.com and/or')).toBe('user@example.com and/or');
  });
});
