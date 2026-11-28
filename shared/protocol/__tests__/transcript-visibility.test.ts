import { describe, expect, it, vi } from 'vitest';

import { isDetailShown, isDetailVisible, isTranscriptDisplayMessage, visibleSessionMessages } from '@/shared/presentation/transcript';
import type { SessionMessageRecord } from '@/shared/presentation/format';

vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));

const entry = (role: 'user' | 'assistant', details: any[] = [], text = '') => ({
  id: role,
  role,
  createdAt: 1,
  text,
  details,
});

const tool = { id: 't', kind: 'tool' as const, tool: 'bash', command: 'ls', label: 'bash', body: 'a.ts', status: 'running' };
const editTool = { id: 'e', kind: 'tool' as const, tool: 'edit', label: 'Edit', body: '', status: 'completed' };
const reasoning = { id: 'r', kind: 'reasoning' as const, label: 'Reasoning', body: 'thinking' };
const patch = { id: 'p', kind: 'patch' as const, label: 'Patch 1 file', body: 'a.ts' };

describe('transcript visibility', () => {
  it('always shows user and textual assistant messages', () => {
    expect(isTranscriptDisplayMessage(entry('user', [], 'hi'))).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [], 'hello'))).toBe(true);
  });

  it('does not treat a bare native timeline marker as content', () => {
    expect(isTranscriptDisplayMessage(entry('assistant'))).toBe(false);
  });

  it('shows tool-only, reasoning-only, and patch-only turns', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]))).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]))).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]))).toBe(true);
    expect(isDetailVisible(tool)).toBe(true);
    expect(isDetailVisible(reasoning)).toBe(true);
    expect(isDetailVisible(patch)).toBe(true);
  });

  it('shows hidden file tools only when they resolved a diff', () => {
    expect(isDetailVisible(editTool)).toBe(true);
    expect(isDetailShown(editTool)).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [editTool]))).toBe(false);

    const resolved = {
      ...editTool,
      files: [{ file: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1, status: 'modified' as const }],
    };
    expect(isDetailShown(resolved)).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [resolved]))).toBe(true);
  });
});

function record(id: string, role: 'user' | 'assistant' = 'user'): SessionMessageRecord {
  return { info: { id, role } as SessionMessageRecord['info'], parts: [] };
}

describe('revert transcript visibility', () => {
  const messages = [
    record('msg_1', 'user'),
    record('msg_2', 'assistant'),
    record('msg_3', 'user'),
    record('msg_4', 'assistant'),
    record('msg_5', 'user'),
    record('msg_6', 'assistant'),
  ];

  it('returns the held window unchanged without a revert boundary', () => {
    expect(visibleSessionMessages(messages)).toBe(messages);
  });

  it('hides the selected message and every later record', () => {
    expect(visibleSessionMessages(messages, 'msg_3').map(({ info }) => info.id)).toEqual(['msg_1', 'msg_2']);
  });

  it('hides everything when the first message is the boundary', () => {
    expect(visibleSessionMessages(messages, 'msg_1')).toEqual([]);
  });

  it('hides the loaded tail when the boundary is older than a paginated window', () => {
    const window = messages.map((_, index) => record(`msg_1${index}`));
    expect(visibleSessionMessages(window, 'msg_01')).toEqual([]);
  });

  it('keeps the loaded window when the boundary is newer than a paginated window', () => {
    expect(visibleSessionMessages(messages, 'msg_9').map(({ info }) => info.id)).toEqual(messages.map(({ info }) => info.id));
  });
});
