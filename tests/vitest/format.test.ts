import { describe, it, expect, vi } from 'vitest';

import { getMessagePreview, toTranscriptEntry, deriveTodosFromMessages } from '@/lib/opencode/format';
import { getUserTurnForMessage } from '@/lib/opencode/transcript';

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

  it('renders completed tool attachments', () => {
    const toolAttachment = toTranscriptEntry({
      info,
      parts: [{ id: 'tool-2', type: 'tool', tool: 'capture', state: { status: 'completed', output: 'done', attachments: [{ type: 'file', mime: 'image/png', filename: 'result.png' }] } }],
    } as never);
    expect(toolAttachment.details[1].label).toBe('result.png');
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

describe('transcript turn lookup', () => {
  const turnRecords = [
    { info: { id: 'user-a', role: 'user' }, parts: [] },
    { info: { id: 'reply-a', role: 'assistant', parentID: 'user-a' }, parts: [] },
    { info: { id: 'user-b', role: 'user' }, parts: [] },
    { info: { id: 'reply-b', role: 'assistant', parentID: 'user-b' }, parts: [] },
  ] as never[];

  it('maps a reply to its user turn', () => {
    expect(getUserTurnForMessage(turnRecords, 'reply-a')).toBe('user-a');
    expect(getUserTurnForMessage(turnRecords, 'reply-b')).toBe('user-b');
  });

  it('returns undefined for pruned or orphaned turns', () => {
    expect(getUserTurnForMessage(turnRecords.slice(2), 'reply-a')).toBeUndefined();
    expect(getUserTurnForMessage([{ info: { id: 'orphan', role: 'assistant', parentID: 'missing' }, parts: [] }] as never[], 'orphan')).toBeUndefined();
  });

  it('maps a v2 reply without a parent link to the preceding user message', () => {
    expect(getUserTurnForMessage([
      { info: { id: 'user-a', role: 'user' }, parts: [] },
      { info: { id: 'reply', role: 'assistant' }, parts: [] },
    ] as never[], 'reply')).toBe('user-a');
  });
});
