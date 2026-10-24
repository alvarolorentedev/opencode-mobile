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
const reasoningRecord = (id: string): Message => ({
  info: info(id),
  parts: [{ id: `${id}-reasoning`, sessionID: 's', messageID: id, type: 'reasoning' as const, text: 'thinking' }],
});

const page = (records: Message[], hasMore = false, nextBefore = hasMore ? 'cursor' : undefined) => ({ records, hasMore, nextBefore });

async function mountTranscript(
  initial: Record<string, Message[]>,
  getSessionMessages: ReturnType<typeof vi.fn>,
  verbosity: transcript.TranscriptVerbosity = 'basic',
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
      transcriptVerbosity: verbosity,
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
  it('cold load downloads one newest page when it already fills the display target', async () => {
    const getSessionMessages = vi.fn(async () => page([textRecord('a'), textRecord('b')]));
    const { runtime, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('backfills older pages until ten displayable entries are loaded', async () => {
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page(Array.from({ length: 20 }, (_value, index) => toolRecord(`t${index}`)), true, 'c1');
      }
      return page(Array.from({ length: 10 }, (_value, index) => textRecord(`d${index}`)), false);
    });
    const { runtime, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 50, before: 'c1' });
    expect(ids(runtime.value.messagesBySession.s).slice(0, 10)).toEqual(Array.from({ length: 10 }, (_value, index) => `d${index}`));
    expect(runtime.value.messagesBySession.s).toHaveLength(30);
  });

  it('counts reasoning rows toward the display target at the reasoning level', async () => {
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page(Array.from({ length: 20 }, (_value, index) => toolRecord(`t${index}`)), true, 'c1');
      }
      return page(Array.from({ length: 10 }, (_value, index) => reasoningRecord(`r${index}`)), false);
    });
    const { runtime, value } = await mountTranscript({}, getSessionMessages, 'reasoning');
    await value.refreshMessages('s');
    runtime.flush();
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(ids(runtime.value.messagesBySession.s).slice(0, 10)).toEqual(Array.from({ length: 10 }, (_value, index) => `r${index}`));
  });

  it('tail merge appends new records without dropping the held window', async () => {
    const getSessionMessages = vi.fn(async () => page([toolRecord('b'), toolRecord('c')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b', 'c']);
    // No backward bridging: a tail sync is a single fetch.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
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
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 20, before: 'older-cursor' });
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    expect(runtime.value.messageWindows.s.hasMore).toBe(false);
  });

  it('rebuilds a missing window when scroll-up runs before any refresh', async () => {
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page([textRecord('b'), textRecord('c')], true, 'older-cursor');
      }
      return page([textRecord('a')], false);
    });
    const { runtime, value } = await mountTranscript({ s: [textRecord('c')] }, getSessionMessages);
    await value.loadOlderMessages('s');
    runtime.flush();
    // The fallback rebuilds the newest window; its display-target backfill
    // pulls the older page in the same pass.
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 50, before: 'older-cursor' });
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
    const getSessionMessages = vi.fn(async () => page([textRecord('x'), textRecord('y')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['x', 'y']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('drops tool-only records before conversation entries at the hard ceiling', async () => {
    const displayed = Array.from({ length: 10 }, (_value, index) => textRecord(`d${index}`));
    const tools = Array.from({ length: 290 }, (_value, index) => toolRecord(`t${index}`));
    const held = [...displayed, ...tools];
    const getSessionMessages = vi.fn(async () => page([toolRecord('t289'), toolRecord('t290')]));
    const { runtime, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    runtime.flush();
    const result = runtime.value.messagesBySession.s;
    expect(result).toHaveLength(300);
    expect(ids(result).slice(0, 10)).toEqual(Array.from({ length: 10 }, (_value, index) => `d${index}`));
    expect(ids(result)).not.toContain('t0');
    expect(ids(result).at(-1)).toBe('t290');
  });

  it('replace discards the held window for a server-side rewrite', async () => {
    const getSessionMessages = vi.fn(async () => page([textRecord('z')]));
    const { runtime, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s', true, { mode: 'replace' });
    runtime.flush();
    expect(ids(runtime.value.messagesBySession.s)).toEqual(['z']);
  });
});
