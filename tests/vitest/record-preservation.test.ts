import { describe, it, expect, vi } from 'vitest';

import { mergeSessionMessageWindow, prependSessionMessageHistory, toTranscriptEntry } from '@/lib/opencode/format';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

function record(id: string, text: string, error?: string) {
  return {
    info: { id, role: 'assistant', sessionID: 'session-1', time: { created: Number(id.split('-')[1]) * 1000 }, ...(error ? { error } : {}) },
    parts: [{ type: 'text', text }],
  } as never;
}

const before = [record('m-1', 'first'), record('m-2', 'second')];

describe('mergeSessionMessageWindow', () => {
  it('preserves array and record identity for an identical tail fetch', () => {
    const identical = [record('m-1', 'first'), record('m-2', 'second')];
    const sameMerge = mergeSessionMessageWindow(before, identical);
    expect(sameMerge).toBe(before);
    expect(sameMerge[0]).toBe(before[0]);
    expect(sameMerge[1]).toBe(before[1]);
  });

  it('adopts a changed record while preserving unchanged siblings', () => {
    const changedContent = [record('m-1', 'first'), record('m-2', 'second, now longer')];
    const contentMerge = mergeSessionMessageWindow(before, changedContent);
    expect(contentMerge).not.toBe(before);
    expect(contentMerge[0]).toBe(before[0]);
    expect(contentMerge[1]).toBe(changedContent[1]);
    expect((contentMerge[1] as never as { parts: { text: string }[] }).parts[0].text).toBe('second, now longer');
  });

  it('adopts a record whose info changed but parts did not', () => {
    const errored = [record('m-1', 'first'), record('m-2', 'second', 'stream failed')];
    const errorMerge = mergeSessionMessageWindow(before, errored);
    expect(errorMerge).not.toBe(before);
    expect(errorMerge[0]).toBe(before[0]);
    expect(errorMerge[1]).toBe(errored[1]);
    expect((errorMerge[1] as never as { info: { error: string } }).info.error).toBe('stream failed');
  });

  it('appends new records and preserves prior refs', () => {
    const appended = [record('m-1', 'first'), record('m-2', 'second'), record('m-3', 'third')];
    const appendMerge = mergeSessionMessageWindow(before, appended);
    expect(appendMerge).not.toBe(before);
    expect(appendMerge[0]).toBe(before[0]);
    expect(appendMerge[1]).toBe(before[1]);
    expect((appendMerge[2] as never as { info: { id: string } }).info.id).toBe('m-3');
  });

  it('keeps the existing window untouched for an empty tail page', () => {
    expect(mergeSessionMessageWindow(before, [])).toBe(before);
  });

  it('places unseen records next to their page anchor instead of at the tail', () => {
    const duplicateAndNew = [record('m-1', 'first'), record('m-1', 'first'), record('m-9', 'unknown')];
    const mixedMerge = mergeSessionMessageWindow(before, duplicateAndNew);
    expect(mixedMerge).not.toBe(before);
    expect(mixedMerge[0]).toBe(before[0]);
    expect(mixedMerge[1]).toBe(duplicateAndNew[2]);
    expect(mixedMerge[2]).toBe(before[1]);
  });

  it('puts an older unseen record before its first page anchor', () => {
    const held = [record('m-2', 'second'), record('m-3', 'third')];
    const stale = [record('m-1', 'first prompt'), record('m-2', 'second')];
    const merged = mergeSessionMessageWindow(held, stale);
    expect(merged.map((entry) => (entry as never as { info: { id: string } }).info.id)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('puts an unseen record between anchors after the preceding anchor', () => {
    const held = [record('m-1', 'first'), record('m-3', 'third')];
    const fetched = [record('m-1', 'first'), record('m-2', 'second'), record('m-3', 'third')];
    const merged = mergeSessionMessageWindow(held, fetched);
    expect(merged.map((entry) => (entry as never as { info: { id: string } }).info.id)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('fills gaps from a stale page without rolling streamed content back', () => {
    const held = [record('m-2', 'second, final'), record('m-3', 'third')];
    const stale = [record('m-1', 'first prompt'), record('m-2', 'second, earlier')];
    const merged = mergeSessionMessageWindow(held, stale, { applyUpdates: false, adoptUnknownWindow: false });
    expect(merged.map((entry) => (entry as never as { info: { id: string } }).info.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(merged[1]).toBe(held[0]);
  });

  it('does not adopt a non-overlapping page when adoption is disabled', () => {
    const held = [record('m-2', 'second')];
    const stale = [record('m-1', 'first')];
    expect(mergeSessionMessageWindow(held, stale, { adoptUnknownWindow: false })).toBe(held);
  });

  it('adopts the fetched array when the previous window is empty', () => {
    const fresh = [record('m-1', 'first')];
    expect(mergeSessionMessageWindow([], fresh)).toBe(fresh);
  });
});

describe('prependSessionMessageHistory', () => {
  it('puts unseen older records first and drops overlap', () => {
    const older = [record('m-0', 'older a'), record('m-1', 'first')];
    const prepended = prependSessionMessageHistory(before, older);
    expect(prepended).not.toBe(before);
    expect(prepended.map((entry) => (entry as never as { info: { id: string } }).info.id)).toEqual(['m-0', 'm-1', 'm-2']);
    expect(prepended[1]).toBe(before[0]);
    expect(prepended[0]).toBe(older[0]);
  });

  it('preserves identity for empty or fully overlapping pages', () => {
    expect(prependSessionMessageHistory(before, [])).toBe(before);
    expect(prependSessionMessageHistory(before, [record('m-1', 'first')])).toBe(before);
  });
});

describe('transcript entry cache', () => {
  it('reuses the cached entry for a preserved record ref', () => {
    const entryBefore = toTranscriptEntry(before[0]);
    const identical = [record('m-1', 'first'), record('m-2', 'second')];
    const sameMerge = mergeSessionMessageWindow(before, identical);
    expect(toTranscriptEntry(sameMerge[0])).toBe(entryBefore);
  });
});
