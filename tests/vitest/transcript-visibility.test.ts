import { describe, expect, it, vi } from 'vitest';

import { isCollapsibleDetail, isDetailShown, isDetailVisible, isTranscriptDisplayMessage, shouldShowPatchSummary, type TranscriptVerbosity } from '@/lib/opencode/transcript';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

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

describe('transcript verbosity', () => {
  it('always shows user and textual assistant messages', () => {
    const levels: TranscriptVerbosity[] = ['basic', 'reasoning', 'verbose'];
    for (const level of levels) {
      expect(isTranscriptDisplayMessage(entry('user', [], 'hi'), level)).toBe(true);
      expect(isTranscriptDisplayMessage(entry('assistant', [], 'hello'), level)).toBe(true);
    }
  });

  it('hides tool-only messages until verbose', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'basic')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'reasoning')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'verbose')).toBe(true);
    expect(isCollapsibleDetail(tool)).toBe(true);
    expect(isDetailVisible(tool, 'basic')).toBe(false);
    expect(isDetailVisible(tool, 'reasoning')).toBe(false);
    expect(isDetailVisible(tool, 'verbose')).toBe(true);
  });

  it('surfaces reasoning from the reasoning level', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'basic')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'reasoning')).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'verbose')).toBe(true);
    expect(isDetailVisible(reasoning, 'basic')).toBe(false);
    expect(isDetailVisible(reasoning, 'reasoning')).toBe(true);
    expect(isDetailVisible(reasoning, 'verbose')).toBe(true);
  });

  it('treats patches as tool output, not conversation', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]), 'basic')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]), 'reasoning')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]), 'verbose')).toBe(true);
  });

  it('keeps the patch chip at lower detail and defers to activity rows at verbose', () => {
    expect(shouldShowPatchSummary('basic')).toBe(true);
    expect(shouldShowPatchSummary('reasoning')).toBe(true);
    expect(shouldShowPatchSummary('verbose')).toBe(false);
  });

  it('hides unresolved file-mutating tools but keeps resolved diff cards visible', () => {
    expect(isDetailVisible(editTool, 'verbose')).toBe(true);
    expect(isDetailShown(editTool, 'verbose')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [editTool]), 'verbose')).toBe(false);

    const resolved = {
      ...editTool,
      files: [{ file: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1, status: 'modified' as const }],
    };
    expect(isDetailShown(resolved, 'verbose')).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [resolved]), 'verbose')).toBe(true);
  });
});
