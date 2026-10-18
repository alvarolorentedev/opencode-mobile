import { describe, expect, it, vi } from 'vitest';

import * as format from '@/lib/opencode/format';
import * as usage from '@/lib/opencode/usage';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

// Minimal native message record; the transcript window only needs info.id and
// stable part arrays for the merge paths under test.
const record = (id: string, created = 1) => ({ info: { id, role: 'assistant', time: { created } }, parts: [] } as any);

async function mountTranscript(
  initial: Record<string, any[]>,
  getSessionMessages: ReturnType<typeof vi.fn>,
) {
  const runtime = hookRuntime();
  const { useTranscriptState } = await loadTs('providers/use-transcript-state.ts', {
    react: runtime.react,
    '@/lib/opencode/format': format,
    '@/lib/opencode/usage': usage,
    '@/providers/opencode-provider-utils': { pruneByKeepIds },
    '@/providers/services/session-service': { getSessionMessages, TRANSCRIPT_PAGE_LIMIT: 20 },
  });
  function useHarness() {
    const [messagesBySession, setMessagesBySession] = runtime.react.useState(initial);
    const [, setIsRefreshingMessages] = runtime.react.useState(false);
    const transcript = useTranscriptState({
      client: {} as never,
      isCurrentClient: () => true,
      messagesBySession,
      setMessagesBySession,
      setIsRefreshingMessages,
    });
    return { ...transcript, messagesBySession };
  }
  const value = runtime.mount(useHarness, {});
  return { runtime, value };
}

const page = (records: any[], hasMore = false) => ({ records, hasMore, nextBefore: hasMore ? 'cursor' : undefined });

describe('transcript refresh policy', () => {
  it('cold load downloads exactly one newest page', async () => {
    const getSessionMessages = vi.fn(async () => page([record('a'), record('b')]));
    const { runtime, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s.map((item: any) => item.info.id)).toEqual(['a', 'b']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('tail merge appends new records without dropping the held window', async () => {
    const getSessionMessages = vi.fn(async () => page([record('b'), record('c')]));
    const { runtime, value } = await mountTranscript({ s: [record('a'), record('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s.map((item: any) => item.info.id)).toEqual(['a', 'b', 'c']);
    // No backward bridging: a tail sync is a single fetch.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('keeps held records for a deferred or empty tail page', async () => {
    const held = [record('a')];
    const getSessionMessages = vi.fn(async () => page([]));
    const { runtime, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s).toBe(held);
  });

  it('adopts the fetched page when a burst does not overlap the held window', async () => {
    const getSessionMessages = vi.fn(async () => page([record('x'), record('y')]));
    const { runtime, value } = await mountTranscript({ s: [record('a'), record('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s.map((item: any) => item.info.id)).toEqual(['x', 'y']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('bounds the merged window at the cap by dropping the oldest records', async () => {
    const held = Array.from({ length: 100 }, (_value, index) => record(`r${index}`));
    const getSessionMessages = vi.fn(async () => page([record('r99'), record('r100')]));
    const { runtime, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    const ids = runtime.value.messagesBySession.s.map((item: any) => item.info.id);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('r1');
    expect(ids[99]).toBe('r100');
  });

  it('replace discards the held window for a server-side rewrite', async () => {
    const getSessionMessages = vi.fn(async () => page([record('z')]));
    const { runtime, value } = await mountTranscript({ s: [record('a'), record('b')] }, getSessionMessages);
    await value.refreshMessages('s', true, { mode: 'replace' });
    runtime.flush();
    expect(runtime.value.messagesBySession.s.map((item: any) => item.info.id)).toEqual(['z']);
  });
});
