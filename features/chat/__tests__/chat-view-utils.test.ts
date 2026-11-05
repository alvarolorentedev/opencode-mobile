import { describe, expect, it } from 'vitest';

import { getChatActivityState, getCurrentTurnActivityKey, getEntryModelLabel, getPinnedActivityKey } from '@/features/chat/ui/chat-view-utils';
import { getModelVariantLabel } from '@/features/ai/model/model-variant-label';
import type { TranscriptRow } from '@/shared/presentation/transcript';

describe('transcript model labels', () => {
  const labels = new Map([['openai/gpt-4.1-mini', 'GPT-4.1 mini']]);

  it('prefers the catalog label', () => {
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'openai', modelID: 'gpt-4.1-mini' } }, labels)).toBe('GPT-4.1 mini');
  });

  it('falls back to the raw model id when the catalog misses', () => {
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'retired', modelID: 'old-model' } }, labels)).toBe('old-model');
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'retired', modelID: 'old-model' } }, undefined)).toBe('old-model');
  });

  it('appends the reasoning variant used for the reply', () => {
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'openai', modelID: 'gpt-4.1-mini', variant: 'max' } }, labels, 'Max')).toBe('GPT-4.1 mini · Max');
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'openai', modelID: 'gpt-4.1-mini' } }, labels, 'Max')).toBe('GPT-4.1 mini · Max');
  });

  it('returns nothing without an assistant model', () => {
    expect(getEntryModelLabel({ role: 'assistant' }, labels)).toBeUndefined();
    expect(getEntryModelLabel({ role: 'user', model: { providerID: 'openai', modelID: 'gpt-4.1-mini' } }, labels)).toBeUndefined();
    expect(getEntryModelLabel({ role: 'assistant', model: { providerID: 'openai', modelID: '' } }, labels)).toBeUndefined();
  });
});

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

describe('pinned activity header', () => {
  const activity = (key: string): TranscriptRow => ({
    key: `activity:${key}`,
    type: 'activity',
    group: { key, kind: 'activity', items: [], tools: [], callCount: 0, status: 'idle' },
  });
  const message = (id: string): TranscriptRow => ({
    key: `message:${id}`,
    type: 'message',
    entry: { id, role: 'assistant', text: '', createdAt: 0, details: [] },
  } as TranscriptRow);
  const layouts = [
    { y: 0, height: 100 },
    { y: 100, height: 300 },
    { y: 400, height: 200 },
  ];
  const rows = [message('m1'), activity('a1'), message('m2')];

  it('pins an expanded run only while it covers the viewport top', () => {
    const expanded = new Set(['a1']);
    const at = (offset: number) => getPinnedActivityKey(rows, expanded, offset, 0, (index) => layouts[index]);
    expect(at(0)).toBeUndefined();
    expect(at(100)).toBeUndefined();
    expect(at(101)).toBe('a1');
    expect(at(399)).toBe('a1');
    expect(at(400)).toBeUndefined();
  });

  it('ignores collapsed runs and offsets by the list header padding', () => {
    expect(getPinnedActivityKey(rows, new Set(), 250, 0, (index) => layouts[index])).toBeUndefined();
    expect(getPinnedActivityKey(rows, new Set(['a1']), 110, 12, (index) => layouts[index])).toBeUndefined();
    expect(getPinnedActivityKey(rows, new Set(['a1']), 113, 12, (index) => layouts[index])).toBe('a1');
  });

  it('uses the run that currently covers the viewport top', () => {
    const twoRuns = [activity('a1'), message('m1'), activity('a2')];
    const twoLayouts = [{ y: 0, height: 200 }, { y: 200, height: 100 }, { y: 300, height: 200 }];
    const expanded = new Set(['a1', 'a2']);
    const at = (offset: number) => getPinnedActivityKey(twoRuns, expanded, offset, 0, (index) => twoLayouts[index]);
    expect(at(50)).toBe('a1');
    expect(at(250)).toBeUndefined();
    expect(at(350)).toBe('a2');
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
