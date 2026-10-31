import { describe, expect, it } from 'vitest';

import { getChatActivityState, getCurrentTurnActivityKey } from '@/features/chat/ui/chat-view-utils';
import { getModelVariantLabel } from '@/features/ai/model/model-variant-label';
import type { TranscriptRow } from '@/shared/presentation/transcript';

describe('model variant labels', () => {
  it('translates common variants and preserves unknown server IDs', () => {
    const t = (key: string) => `translated:${key}`;

    expect(getModelVariantLabel(undefined, t)).toBe('translated:chat:reasoning.default');
    expect(getModelVariantLabel('max', t)).toBe('translated:chat:reasoning.max');
    expect(getModelVariantLabel('custom-effort', t)).toBe('custom-effort');
  });
});

describe('current turn activity anchor', () => {
  const activity = (key: string): TranscriptRow => ({
    key: `activity:${key}`,
    type: 'activity',
    group: { key, kind: 'activity', items: [], tools: [], callCount: 0, status: 'running' },
  });
  const message = (id: string, role: 'user' | 'assistant'): TranscriptRow => ({
    key: `message:${id}`,
    type: 'message',
    entry: { id, role, text: '', createdAt: 0, details: [] },
  } as TranscriptRow);

  it('uses the newest activity row in the current turn', () => {
    expect(getCurrentTurnActivityKey([message('u1', 'user'), activity('a1'), message('a1', 'assistant'), activity('a2')])).toBe('activity:a2');
  });

  it('does not anchor progress to the previous turn after a new user message', () => {
    expect(getCurrentTurnActivityKey([message('u1', 'user'), activity('a1'), message('u2', 'user')])).toBeUndefined();
  });

  it('keeps the anchor after assistant text until a new user turn starts', () => {
    expect(getCurrentTurnActivityKey([message('u1', 'user'), activity('a1'), message('a1', 'assistant')])).toBe('activity:a1');
  });
});

describe('chat activity state', () => {
  const base = {
    awaitingUserInput: false,
    pendingActive: false,
    sendingStateActive: false,
    status: { type: 'idle' as const },
    submitting: false,
  };

  it('reports local sending before any server status arrives', () => {
    expect(getChatActivityState({ ...base, submitting: true, status: undefined })).toBe('sending');
    expect(getChatActivityState({ ...base, sendingStateActive: true, status: undefined })).toBe('sending');
  });

  it('reports waiting for admitted prompts while the session is idle', () => {
    expect(getChatActivityState({ ...base, pendingActive: true })).toBe('waiting');
  });

  it('prefers server busy and retry states over a pending prompt label', () => {
    expect(getChatActivityState({ ...base, pendingActive: true, status: { type: 'busy' } })).toBe('working');
    expect(getChatActivityState({
      ...base,
      status: { type: 'retry', attempt: 2, message: 'Provider overloaded', next: Date.now() + 5_000 },
    })).toBe('retrying');
  });

  it('stays hidden while user input blocks the turn', () => {
    expect(getChatActivityState({ ...base, awaitingUserInput: true, status: { type: 'busy' }, submitting: true })).toBeUndefined();
  });

  it('stays hidden when idle', () => {
    expect(getChatActivityState(base)).toBeUndefined();
  });
});
