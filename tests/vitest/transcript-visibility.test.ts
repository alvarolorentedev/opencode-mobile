import { describe, expect, it, vi } from 'vitest';

import { isCollapsibleDetail, isDetailVisible, isTranscriptDisplayMessage, type TranscriptVerbosity } from '@/lib/opencode/transcript';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

const entry = (role: 'user' | 'assistant', details: any[] = [], text = '') => ({
  id: role,
  role,
  createdAt: 1,
  text,
  details,
});

const tool = { id: 't', kind: 'tool' as const, label: 'Edit', body: '', status: 'running' };
const reasoning = { id: 'r', kind: 'reasoning' as const, label: 'Reasoning', body: 'thinking' };
const patch = { id: 'p', kind: 'patch' as const, label: 'Patch 1 file', body: 'a.ts' };

describe('transcript verbosity', () => {
  it('always shows user and textual assistant messages', () => {
    const levels: TranscriptVerbosity[] = ['conversation', 'tools', 'verbose'];
    for (const level of levels) {
      expect(isTranscriptDisplayMessage(entry('user', [], 'hi'), level)).toBe(true);
      expect(isTranscriptDisplayMessage(entry('assistant', [], 'hello'), level)).toBe(true);
    }
  });

  it('hides tool-only messages at conversation verbosity and shows them as collapsible rows above it', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'conversation')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'tools')).toBe(true);
    expect(isTranscriptDisplayMessage(entry('assistant', [tool]), 'verbose')).toBe(true);
    expect(isCollapsibleDetail(tool)).toBe(true);
    expect(isDetailVisible(tool, 'conversation')).toBe(false);
  });

  it('only surfaces reasoning at verbose', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'conversation')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'tools')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [reasoning]), 'verbose')).toBe(true);
    expect(isDetailVisible(reasoning, 'tools')).toBe(false);
    expect(isDetailVisible(reasoning, 'verbose')).toBe(true);
  });

  it('treats patches as tool output, not conversation', () => {
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]), 'conversation')).toBe(false);
    expect(isTranscriptDisplayMessage(entry('assistant', [patch]), 'tools')).toBe(true);
  });
});
