import { describe, expect, it, vi } from 'vitest';

import * as format from '@/lib/opencode/format';
import * as transcript from '@/lib/opencode/transcript';
import * as usage from '@/lib/opencode/usage';
import { pruneByKeepIds } from '@/providers/opencode-provider-utils';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

type Message = {
  info: { id: string; role: 'assistant'; time: { created: number } };
  parts: any[];
};

const info = (id: string) => ({ id, role: 'assistant' as const, time: { created: 1 } });
const toolRecord = (id: string): Message => ({
  info: info(id),
  parts: [{ id: `${id}-tool`, sessionID: 's', messageID: id, type: 'tool' as const, callID: id, tool: 'bash', state: { status: 'running' as const, input: { command: 'ls' }, title: 'bash' } }],
});
const textRecord = (id: string, text = 'Hello'): Message => ({
  info: info(id),
  parts: [{ id: `${id}-text`, sessionID: 's', messageID: id, type: 'text' as const, text }],
});

const page = (records: Message[], hasMore = false, nextBefore = hasMore ? 'cursor' : undefined) => ({ records, hasMore, nextBefore });

async function mountTranscript(
  initial: Record<string, Message[]>,
  getSessionMessages: ReturnType<typeof vi.fn>,
) {
  const runtime = hookRuntime();
  const { useTranscriptState } = await loadTs('providers/use-transcript-state.ts', {
    react: runtime.react,
    '@/lib/opencode/format': format,
    '@/lib/opencode/transcript': transcript,
    '@/lib/opencode/usage': usage,
    '@/providers/opencode-provider-utils': { pruneByKeepIds },
    '@/providers/services/session-service': { getSessionMessages, TRANSCRIPT_PAGE_LIMIT: 20 },
    '@/providers/transcript-cache': { hydrateTranscriptCache: async () => {}, persistTranscriptCache: async () => {} },
  });
  function useHarness() {
    const [messagesBySession, setMessagesBySession] = runtime.react.useState(initial);
    const [, setIsRefreshingMessages] = runtime.react.useState(false);
    const state = useTranscriptState({
      client: {} as never,
      isCurrentClient: () => true,
      currentSessionId: 's',
      connectionScope: 'scope',
      activeProjectPath: '/repo',
      messagesBySession,
      setMessagesBySession,
      setIsRefreshingMessages,
    });
    return { ...state, messagesBySession };
  }
  const value = runtime.mount(useHarness, {});
  return { runtime, value };
}

const ids = (records: Message[]) => records.map((item) => item.info.id);

describe('transcript refresh policy', () => {
  it('cold load downloads one newest window with a single read', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('a'), textRecord('b')]));
    const { runtime, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 300 });
  });

  it('tail merge appends new records without dropping the held window', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([toolRecord('b'), toolRecord('c')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b', 'c']);
    // Reconcile is a single newest-page fetch, never a backfill scan.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
  });

  it('tail merge keeps older loaded history beyond the initial window', async () => {
    const held = Array.from({ length: 300 }, (_value, index) => textRecord(`h${index}`));
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('h299'), textRecord('new')]));
    const { runtime, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s).toHaveLength(301);
    expect(runtime.value.messagesBySession.s[0].info.id).toBe('h0');
    expect(runtime.value.messagesBySession.s.at(-1)?.info.id).toBe('new');
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
  });

  it('repairs a missing paging window for held records before paging back', async () => {
    const newest = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((id) => textRecord(id));
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page(newest, true, 'older-cursor');
      }
      return page([textRecord('a')], false);
    });
    const { runtime, value } = await mountTranscript({ s: [textRecord('b'), textRecord('c')] }, getSessionMessages);
    await value.refreshMessages('s', true);
    runtime.flush();
    expect(runtime.value.messageWindows.s).toEqual({ nextBefore: 'older-cursor', hasMore: true });
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);

    await value.loadOlderMessages('s');
    runtime.flush();
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 300, before: 'older-cursor' });
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    expect(runtime.value.messageWindows.s.hasMore).toBe(false);
  });

  it('repairs a missing window with one read, then pages on the next scroll', async () => {
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page([textRecord('b'), textRecord('c')], true, 'older-cursor');
      }
      return page([textRecord('a')], false);
    });
    const { runtime, value } = await mountTranscript({ s: [textRecord('c')] }, getSessionMessages);
    await value.loadOlderMessages('s');
    runtime.flush();
    // The repair is one newest-window read; it does not chain an older page.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 300 });
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['b', 'c']);
    expect(runtime.value.messageWindows.s).toEqual({ nextBefore: 'older-cursor', hasMore: true });

    await value.loadOlderMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 300, before: 'older-cursor' });
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b', 'c']);
    expect(runtime.value.messageWindows.s.hasMore).toBe(false);
  });

  it('keeps held records for a deferred or empty tail page', async () => {
    const held = [toolRecord('a')];
    const getSessionMessages = vi.fn(async () => page([]));
    const { runtime, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(runtime.value.messagesBySession.s).toBe(held);
  });

  it('adopts the fetched page when a burst does not overlap the held window', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('x'), textRecord('y')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['x', 'y']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
  });

  it('loads history older than the initial window and reaches the first record', async () => {
    const history = Array.from({ length: 320 }, (_value, index) => textRecord(`m${index}`));
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page(history.slice(20), true, 'cursor-300');
      }
      return page(history.slice(0, 20), false);
    });
    const { runtime, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 300 });
    expect(runtime.value.messagesBySession.s).toHaveLength(300);

    await value.loadOlderMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 300, before: 'cursor-300' });
    expect(runtime.value.messagesBySession.s).toHaveLength(320);
    expect(runtime.value.messagesBySession.s[0].info.id).toBe('m0');
    expect(runtime.value.messagesBySession.s.at(-1)?.info.id).toBe('m319');
    expect(runtime.value.messageWindows.s.hasMore).toBe(false);

    await value.loadOlderMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
  });

  it('replace discards the held window for a server-side rewrite', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('z')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s', true, { mode: 'replace' });
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['z']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 300 });
  });
});
