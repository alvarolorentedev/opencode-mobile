import { describe, it, expect, vi } from 'vitest';

import { toTranscriptEntry } from '@/lib/opencode/format';
import { getTurnPatchDetails, resolveDiffTurn } from '@/lib/opencode/transcript';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

// V2 records a turn's changes on assistant snapshots; V1 records them on the
// user message summary. Both shapes must group the same way.
function user(id: string, diffs?: unknown[]) {
  return {
    info: { id, role: 'user', sessionID: 'session-1', time: { created: 1 }, ...(diffs ? { summary: { diffs } } : {}) },
    parts: [],
  } as never;
}

function assistant(id: string, files: string[] = []) {
  return {
    info: { id, role: 'assistant', sessionID: 'session-1', time: { created: 2 } },
    parts: files.length ? [{ id: `${id}-patch`, type: 'patch', files }] : [],
  } as never;
}

const changedFirstTurn = [user('u1'), assistant('a1', ['src/a.ts', 'src/b.ts']), user('u2'), assistant('a2')];
const twoChangedTurns = [user('u1'), assistant('a1', ['src/a.ts']), user('u2'), assistant('a2', ['src/c.ts'])];

describe('resolveDiffTurn', () => {
  it('prefers the newest turn that recorded a change over a newer no-op turn', () => {
    expect(resolveDiffTurn(changedFirstTurn)).toBe('u1');
  });

  it('keeps a pinned turn that still has a recorded change', () => {
    expect(resolveDiffTurn(twoChangedTurns, 'u1')).toBe('u1');
  });

  it('falls back to the newest changed turn when the pin is stale', () => {
    expect(resolveDiffTurn(twoChangedTurns, 'deleted-turn')).toBe('u2');
  });

  it('falls back to the newest user message before any turn records a change', () => {
    expect(resolveDiffTurn([user('u1'), assistant('a1'), user('u2'), assistant('a2')])).toBe('u2');
  });

  it('treats a v1 user-turn summary as a recorded change', () => {
    expect(resolveDiffTurn([user('u1', [{}]), assistant('a1', ['src/a.ts'])])).toBe('u1');
  });

  it('returns undefined without a user message', () => {
    expect(resolveDiffTurn([])).toBeUndefined();
    expect(resolveDiffTurn([assistant('a1', ['src/a.ts'])])).toBeUndefined();
  });
});

describe('getTurnPatchDetails', () => {
  it('scopes filename-only details to the selected turn', () => {
    const transcript = changedFirstTurn.map(toTranscriptEntry);
    const first = getTurnPatchDetails(transcript, changedFirstTurn, 'u1');
    expect(first).toHaveLength(1);
    expect(first[0].body).toBe('src/a.ts\nsrc/b.ts');
    expect(getTurnPatchDetails(transcript, changedFirstTurn, 'u2')).toHaveLength(0);
  });

  it('keeps every turn when no turn is selected', () => {
    const transcript = twoChangedTurns.map(toTranscriptEntry);
    expect(getTurnPatchDetails(transcript, twoChangedTurns)).toHaveLength(2);
  });
});
