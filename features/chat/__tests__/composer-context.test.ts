import { describe, expect, it, vi } from 'vitest';

import { findComposerTrigger, parseShellCommand, replaceComposerTrigger } from '@/features/chat/model/composer';
import { resolvePromptContext } from '@/shared/protocol/opencode/prompt-context';
import { toTranscriptEntry } from '@/shared/presentation/format';
import { toMessageRecord } from '@/shared/protocol/opencode/v2/mappers';

vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));

describe('composer triggers', () => {
  it('finds slash commands only at the start of the draft', () => {
    expect(findComposerTrigger('/rev', 4)).toEqual({ kind: 'command', start: 0, end: 4, query: 'rev' });
    expect(findComposerTrigger('run /rev', 8)).toBeUndefined();
    expect(findComposerTrigger('/review src', 11)).toBeUndefined();
  });

  it('finds context tokens after whitespace but not inside words', () => {
    expect(findComposerTrigger('Review @src/de', 14)).toEqual({ kind: 'context', start: 7, end: 14, query: 'src/de' });
    expect(findComposerTrigger('user@example', 12)).toBeUndefined();
    expect(findComposerTrigger('@', 1)).toEqual({ kind: 'context', start: 0, end: 1, query: '' });
  });

  it('replaces only the active token and returns the next cursor', () => {
    const trigger = findComposerTrigger('Review @src/de', 14)!;
    expect(replaceComposerTrigger('Review @src/de now', trigger, '@src/demo.ts ')).toEqual({
      text: 'Review @src/demo.ts  now',
      cursor: 20,
    });
  });
});

describe('shell commands', () => {
  it('parses only a leading bang command', () => {
    expect(parseShellCommand('!npm test')).toBe('npm test');
    expect(parseShellCommand('!   ')).toBeUndefined();
    expect(parseShellCommand('please run !npm test')).toBeUndefined();
  });
});

describe('prompt context', () => {
  it('resolves agent, skill, and file mentions from the final text', () => {
    const text = 'Review @src/demo.ts with @general and @opencode';
    const resolved = resolvePromptContext(text, [
      { kind: 'file', path: '/workspace/demo/src/demo.ts', token: '@src/demo.ts' },
      { kind: 'agent', name: 'general', token: '@general' },
      { kind: 'skill', id: 'opencode', name: 'opencode', token: '@opencode' },
    ]);

    expect(resolved.files).toEqual([{
      uri: 'file:///workspace/demo/src/demo.ts',
      name: 'src/demo.ts',
      mention: { start: 7, end: 19, text: '@src/demo.ts' },
    }]);
    expect(resolved.agents).toEqual([{ name: 'general', mention: { start: 25, end: 33, text: '@general' } }]);
    expect(resolved.skills).toEqual([{ id: 'opencode', mention: { start: 38, end: 47, text: '@opencode' } }]);
  });

  it('drops mentions that were edited out of the draft', () => {
    expect(resolvePromptContext('plain prompt', [
      { kind: 'agent', name: 'general', token: '@general' },
    ])).toEqual({ files: [], agents: [], skills: [] });
  });
});

describe('shell transcript records', () => {
  it('maps a completed shell record to the existing shell activity row', () => {
    const record = toMessageRecord({
      id: 'shell-1',
      type: 'shell',
      time: { created: 10, completed: 20 },
      command: 'echo hi',
      status: 'exited',
      exit: 0,
      output: { output: 'hi', cursor: 2, size: 2, truncated: false },
    } as never, 'session-1');

    expect(record).toBeDefined();
    const entry = toTranscriptEntry(record!);
    expect(entry.text).toBe('');
    expect(entry.details[0]).toMatchObject({
      kind: 'tool',
      tool: 'shell',
      command: 'echo hi',
      body: 'hi',
      status: 'completed',
    });
  });

  it('keeps a failed shell exit visible', () => {
    const record = toMessageRecord({
      id: 'shell-2',
      type: 'shell',
      time: { created: 10, completed: 20 },
      command: 'false',
      status: 'exited',
      exit: 1,
      output: { output: '', cursor: 0, size: 0, truncated: false },
    } as never, 'session-1');

    expect(toTranscriptEntry(record!).details[0]).toMatchObject({
      kind: 'tool',
      tool: 'shell',
      status: 'error',
      body: 'Shell exited with code 1.',
    });
  });
});
