import { describe, it, expect, vi } from 'vitest';

import { formatDuration, getMessagePreview, toTranscriptEntry, deriveTodosFromMessages } from '@/lib/opencode/format';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

const info = { id: 'message-1', role: 'assistant', sessionID: 'session-1', time: { created: 1 } };

const todoWritePart = (id: string, todos: unknown[]) => ({
  id,
  type: 'tool',
  tool: 'todowrite',
  state: { status: 'completed', input: { todos }, output: '', title: 'todowrite', metadata: {} },
});

describe('format', () => {
  it('prefers visible text over reasoning', () => {
    expect(getMessagePreview({ info, parts: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible reply' }] } as never)).toBe('Visible reply');
  });

  it('renders a failed tool body', () => {
    const failedTool = toTranscriptEntry({
      info,
      parts: [{ id: 'tool-1', type: 'tool', tool: 'build', state: { status: 'error', error: 'Build failed' } }],
    } as never);
    expect(failedTool.details[0].body).toBe('Build failed');
  });

  it('maps reasoning timestamps to a compact duration', () => {
    const reasoning = toTranscriptEntry({
      info,
      parts: [{ id: 'reasoning-1', type: 'reasoning', text: 'thinking', time: { start: 1000, end: 6500 } }],
    } as never);
    expect(reasoning.details[0]).toMatchObject({ kind: 'reasoning', durationMs: 5500 });
    expect(formatDuration(5500)).toBe('6s');
    expect(formatDuration(65000)).toBe('1m 05s');
  });

  it('normalizes read and grep rows without keeping raw input', () => {
    const read = toTranscriptEntry({
      info,
      parts: [{ id: 'read-1', type: 'tool', tool: 'read', state: { status: 'completed', input: { path: 'src/a.ts', offset: 10, limit: 20 }, output: '' } }],
    } as never);
    expect(read.details[0]).toMatchObject({ kind: 'tool', path: 'src/a.ts', offset: 10, limit: 20 });

    const grep = toTranscriptEntry({
      info,
      parts: [{ id: 'grep-1', type: 'tool', tool: 'grep', state: { status: 'completed', input: { path: 'src', pattern: 'foo', include: '*.ts' }, output: '', metadata: { matches: 7 } } }],
    } as never);
    expect(grep.details[0]).toMatchObject({ kind: 'tool', path: 'src', pattern: 'foo', include: '*.ts', matchCount: 7 });
  });

  it('derives expandable file diffs from edit and write input', () => {
    const edit = toTranscriptEntry({
      info,
      parts: [{ id: 'edit-1', type: 'tool', tool: 'edit', state: { status: 'completed', input: { path: 'src/a.ts', oldString: 'a\nb', newString: 'a\nc' }, output: 'ok' } }],
    } as never);
    const editDetail = edit.details[0];
    if (editDetail.kind !== 'tool') throw new Error('expected edit tool detail');
    expect(editDetail).toMatchObject({ path: 'src/a.ts' });
    expect(editDetail.files).toEqual([
      expect.objectContaining({ file: 'src/a.ts', additions: 1, deletions: 1, status: 'modified' }),
    ]);
    expect(editDetail.files?.[0]?.patch).toContain('@@');

    const write = toTranscriptEntry({
      info,
      parts: [{ id: 'write-1', type: 'tool', tool: 'write', state: { status: 'completed', input: { path: 'src/new.ts', content: 'one\ntwo\n' }, output: 'ok' } }],
    } as never);
    const writeDetail = write.details[0];
    if (writeDetail.kind !== 'tool') throw new Error('expected write tool detail');
    expect(writeDetail.files).toEqual([
      expect.objectContaining({ file: 'src/new.ts', additions: 2, deletions: 0, status: 'added' }),
    ]);
  });

  it('prefers server-provided file diffs', () => {
    const edit = toTranscriptEntry({
      info,
      parts: [{
        id: 'edit-2',
        type: 'tool',
        tool: 'edit',
        state: {
          status: 'completed',
          input: { path: 'src/a.ts', oldString: 'a', newString: 'b' },
          output: 'ok',
          metadata: { files: [{ file: 'src/a.ts', patch: '@@ -1 +1 @@\n-old\n+new', additions: 4, deletions: 2, status: 'modified' }] },
        },
      }],
    } as never);
    const detail = edit.details[0];
    if (detail.kind !== 'tool') throw new Error('expected edit tool detail');
    expect(detail.files?.[0]).toMatchObject({ additions: 4, deletions: 2 });
  });

  it('keeps the native tool name and shell command on the detail', () => {
    const shell = toTranscriptEntry({
      info,
      parts: [{ id: 'tool-3', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'ls -la' } } }],
    } as never);
    expect(shell.details[0]).toMatchObject({ kind: 'tool', tool: 'bash', command: 'ls -la' });
  });

  it('renders completed tool attachments', () => {
    const toolAttachment = toTranscriptEntry({
      info,
      parts: [{ id: 'tool-2', type: 'tool', tool: 'capture', state: { status: 'completed', output: 'done', attachments: [{ type: 'file', mime: 'image/png', filename: 'result.png' }] } }],
    } as never);
    expect(toolAttachment.details[1].label).toBe('result.png');
  });

  it('omits V1-only step, subtask and agent parts from the transcript', () => {
    const entry = toTranscriptEntry({
      info,
      parts: [
        { id: 'sub', type: 'subtask', description: 'do work' },
        { id: 'start', type: 'step-start', snapshot: 'abc' },
        { id: 'finish', type: 'step-finish', reason: 'stop', cost: 0, tokens: {} },
        { id: 'agent', type: 'agent', name: 'build' },
      ],
    } as never);
    expect(entry.details).toEqual([]);
  });

  it('derives the latest todo write', () => {
    expect(deriveTodosFromMessages([
      { info, parts: [todoWritePart('tool-todo-1', [
        { content: 'First task', status: 'completed', priority: 'high' },
        { content: 'Second task', status: 'in_progress', priority: 'low' },
      ])] },
    ] as never)).toEqual([
      { content: 'First task', status: 'completed', priority: 'high' },
      { content: 'Second task', status: 'in_progress', priority: 'low' },
    ]);
  });

  it('lets the latest write win, including a clearing write', () => {
    expect(deriveTodosFromMessages([
      { info, parts: [todoWritePart('tool-todo-2', [{ content: 'Stale', status: 'pending', priority: 'low' }])] },
      { info, parts: [todoWritePart('tool-todo-3', [])] },
    ] as never)).toEqual([]);
  });

  it('ignores non-todo tools', () => {
    expect(deriveTodosFromMessages([
      { info, parts: [{ id: 'tool-bash', type: 'tool', tool: 'bash', state: { status: 'completed', input: { todos: [{ content: 'Nope' }] } } }] },
    ] as never)).toEqual([]);
  });
});
