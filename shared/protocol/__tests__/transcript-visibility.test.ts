import { describe, expect, it, vi } from 'vitest';

import { isDetailShown, isDetailVisible, isTranscriptDisplayMessage } from '@/shared/presentation/transcript';

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
