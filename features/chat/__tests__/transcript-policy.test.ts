import { describe, expect, it, onTestFinished, vi } from 'vitest';

import * as format from '@/shared/presentation/format';
import { createProjectTranscript } from '@/features/chat/services/project-transcript';
import { transcriptAccess } from '@/features/chat/services/transcript-queries';
import { createAppStore } from '@/runtime/core/store';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerQueryClient } from '@/shared/server-data/query-client';

const transport = vi.hoisted(() => ({
  messages: (..._args: unknown[]): unknown => undefined,
  message: (..._args: unknown[]): unknown => undefined,
}));

vi.mock('@/shared/protocol/services/session-service', async (original) => ({
  ...await original<typeof import('@/shared/protocol/services/session-service')>(),
  getSessionMessages: (...args: unknown[]) => transport.messages(...args),
  getSessionMessage: (...args: unknown[]) => transport.message(...args),
}));
vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null } }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));

type Message = {
  info: { id: string; role: 'assistant' | 'user'; time: { created: number } };
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
const userRecord = (id: string, text = 'Hello'): Message => ({
  info: { id, role: 'user', time: { created: 1 } },
  parts: [{ id: `${id}-text`, sessionID: 's', messageID: id, type: 'text' as const, text }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const page = (records: Message[], hasMore = false, nextBefore = hasMore ? 'cursor' : undefined) => ({ records, hasMore, nextBefore });

function mountTranscript(
  initial: Record<string, Message[]>,
  getSessionMessages: (...args: any[]) => unknown,
  getSessionMessage: (...args: any[]) => unknown = vi.fn(async () => undefined),
) {
  const store = createAppStore({ settings: { serverUrl: 'http://server.test', username: '', password: '', directory: '/repo' },
    chatPreferences: {} as never, controlPlaneUrl: '' });
  const client = { __opencode: { contract: 'v2', directory: '/repo' } } as ScopedOpencodeClient;
  const queryClient = createServerQueryClient();
  const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };
  const scopeKey = 'transcript-test-workspace';
  const access = transcriptAccess(queryClient, identity, client);
  transport.messages = getSessionMessages;
  transport.message = getSessionMessage;
  for (const [id, records] of Object.entries(initial)) access.restore(id, records as format.SessionMessageRecord[]);
  const value = createProjectTranscript({ store, queryClient, clock: Date.now }, {
    client, identity, scopeKey, activeProjectPath: '/repo', isCurrentClient: (candidate) => candidate === client,
  });
  value.hydrate('s', () => true);
  onTestFinished(() => { value.dispose(); queryClient.clear(); });

  return { value, client, view: {
    messages: () => value.readDisplayedSession('s'),
    window: () => access.window('s'),
    hydrating: () => store.getState().transcriptUi[scopeKey]?.hydratingSessionIds.s,
  } };
}

const ids = (records: Message[]) => records.map((item) => item.info.id);

describe('transcript refresh policy', () => {
  it('cold load downloads one newest window with a single read', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('a'), textRecord('b')]));
    const { view, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    expect(ids(view.messages())).toEqual(['a', 'b']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 200, fresh: true });
  });

  it('reconciles one live message without re-reading the newest page', async () => {
    const getSessionMessages = vi.fn(async () => page([textRecord('a'), textRecord('b')]));
    const getSessionMessage = vi.fn(async () => ({ id: 'b', type: 'assistant', time: { created: 1 },
      content: [{ type: 'text', text: 'streamed reply' }] }));
    const { view, value, client } = await mountTranscript({ s: [userRecord('u'), textRecord('b', 'partial')] }, getSessionMessages, getSessionMessage);
    await value.refreshMessages('s', true, { messageId: 'b' });
    expect(getSessionMessages).not.toHaveBeenCalled();
    expect(getSessionMessage).toHaveBeenCalledWith(client, 's', 'b');
    const latest = view.messages().find((record) => record.info.id === 'b')?.parts[0];
    expect(latest?.type === 'text' ? latest.text : undefined).toBe('streamed reply');
    expect(view.messages()[0].info.id).toBe('u');
  });

  it('keeps an unchanged large user record by identity on merge', () => {
    const url = `data:video/mp4;base64,${'A'.repeat(120_000)}`;
    const prior = {
      info: { id: 'u', sessionID: 's', role: 'user' as const, time: { created: 1 } },
      parts: [{ id: 'u-file', sessionID: 's', messageID: 'u', type: 'file' as const, url, mime: 'video/mp4', filename: 'clip.mp4' }],
    };
    const previous = [prior];
    const next = format.mergeSessionMessageWindow(previous, [structuredClone(prior)]);
    expect(next).toBe(previous);
  });

  it('tail merge appends new records without dropping the held window', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([toolRecord('b'), toolRecord('c')]));
    const { view, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    expect(ids(view.messages())).toEqual(['a', 'b', 'c']);
    // Reconcile is a single newest-page fetch, never a backfill scan.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
  });

  it('tail merge keeps older loaded history beyond the initial window', async () => {
    const held = Array.from({ length: 300 }, (_value, index) => textRecord(`h${index}`));
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('h299'), textRecord('new')]));
    const { view, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    expect(view.messages()).toHaveLength(301);
    expect(view.messages()[0].info.id).toBe('h0');
    expect(view.messages().at(-1)?.info.id).toBe('new');
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
    const { view, value } = await mountTranscript({ s: [textRecord('b'), textRecord('c')] }, getSessionMessages);
    await value.refreshMessages('s', true);
    expect(view.window()).toEqual({ nextBefore: 'older-cursor', hasMore: true });
    expect(ids(view.messages())).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);

    await value.loadOlderMessages('s');
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 20 });
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 200, before: 'older-cursor' });
    expect(ids(view.messages())).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    expect(view.window()!.hasMore).toBe(false);
  });

  it('repairs a missing window with one read, then pages on the next scroll', async () => {
    const getSessionMessages = vi.fn(async (_client, _id, options: { before?: string }) => {
      if (!options.before) {
        return page([textRecord('b'), textRecord('c')], true, 'older-cursor');
      }
      return page([textRecord('a')], false);
    });
    const { view, value } = await mountTranscript({ s: [textRecord('c')] }, getSessionMessages);
    await value.loadOlderMessages('s');
    // The repair is one newest-window read; it does not chain an older page.
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 200, fresh: true });
    expect(ids(view.messages())).toEqual(['b', 'c']);
    expect(view.window()).toEqual({ nextBefore: 'older-cursor', hasMore: true });

    await value.loadOlderMessages('s');
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 200, before: 'older-cursor' });
    expect(ids(view.messages())).toEqual(['a', 'b', 'c']);
    expect(view.window()!.hasMore).toBe(false);
  });

  it('keeps held records for a deferred or empty tail page', async () => {
    const held = [toolRecord('a')];
    const getSessionMessages = vi.fn(async () => page([]));
    const { view, value } = await mountTranscript({ s: held }, getSessionMessages);
    await value.refreshMessages('s');
    expect(view.messages()).toBe(held);
  });

  it('never hydrates the empty state for a silent background refresh', async () => {
    const gate = deferred<ReturnType<typeof page>>();
    const getSessionMessages = vi.fn(() => gate.promise);
    const { view, value } = await mountTranscript({}, getSessionMessages);

    const silent = value.refreshMessages('s', true);
    expect(view.hydrating()).not.toBe(true);

    gate.resolve(page([]));
    await silent;
    expect(view.hydrating()).not.toBe(true);

    // An explicit open still owns the skeleton until its read settles.
    const explicitGate = deferred<ReturnType<typeof page>>();
    getSessionMessages.mockImplementationOnce(() => explicitGate.promise);
    const explicit = value.refreshMessages('s');
    expect(view.hydrating()).toBe(true);

    explicitGate.resolve(page([]));
    await explicit;
    expect(view.hydrating()).toBe(false);
  });

  it('adopts the fetched page when a burst does not overlap the held window', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('x'), textRecord('y')]));
    const { view, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s');
    expect(ids(view.messages())).toEqual(['x', 'y']);
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
    const { view, value } = await mountTranscript({}, getSessionMessages);
    await value.refreshMessages('s');
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 200, fresh: true });
    expect(view.messages()).toHaveLength(300);

    await value.loadOlderMessages('s');
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
    expect(getSessionMessages.mock.calls[1][2]).toEqual({ limit: 200, before: 'cursor-300' });
    expect(view.messages()).toHaveLength(320);
    expect(view.messages()[0].info.id).toBe('m0');
    expect(view.messages().at(-1)?.info.id).toBe('m319');
    expect(view.window()!.hasMore).toBe(false);

    await value.loadOlderMessages('s');
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
  });

  it('replace discards the held window for a server-side rewrite', async () => {
    const getSessionMessages = vi.fn(async (_client: unknown, _id: string, _options?: { before?: string }) => page([textRecord('z')]));
    const { view, value } = await mountTranscript({ s: [toolRecord('a'), toolRecord('b')] }, getSessionMessages);
    await value.refreshMessages('s', true, { mode: 'replace' });
    expect(ids(view.messages())).toEqual(['z']);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(getSessionMessages.mock.calls[0][2]).toEqual({ limit: 200, fresh: true });
  });

  it('keeps the initial prompt above assistant records when an older tail resolves late', async () => {
    const older = deferred<ReturnType<typeof page>>();
    const newer = deferred<ReturnType<typeof page>>();
    const responses = [older.promise, newer.promise];
    let call = 0;
    const getSessionMessages = vi.fn(async () => responses[call++]);
    const { view, value } = await mountTranscript(
      { s: [userRecord('u1', 'plan ux improvements')] },
      getSessionMessages,
    );

    const olderRefresh = value.refreshMessages('s');
    const newerRefresh = value.refreshMessages('s');

    // The newer page no longer contains the initial prompt.
    newer.resolve(page([textRecord('a1'), textRecord('a2')]));
    await newerRefresh;
    expect(ids(view.messages())).toEqual(['a1', 'a2']);

    // The late page still has it; it must be inserted before a1, not appended
    // below the assistant reply.
    older.resolve(page([userRecord('u1', 'plan ux improvements'), textRecord('a1')]));
    await olderRefresh;
    expect(ids(view.messages())).toEqual(['u1', 'a1', 'a2']);
  });

  it('does not replace a newer window with a stale non-overlapping page', async () => {
    const older = deferred<ReturnType<typeof page>>();
    const newer = deferred<ReturnType<typeof page>>();
    const responses = [older.promise, newer.promise];
    let call = 0;
    const getSessionMessages = vi.fn(async () => responses[call++]);
    const { view, value } = await mountTranscript({ s: [textRecord('a1')] }, getSessionMessages);

    const olderRefresh = value.refreshMessages('s');
    const newerRefresh = value.refreshMessages('s');

    newer.resolve(page([textRecord('c1'), textRecord('c2')]));
    await newerRefresh;
    expect(ids(view.messages())).toEqual(['c1', 'c2']);

    older.resolve(page([textRecord('b1')]));
    await olderRefresh;
    expect(ids(view.messages())).toEqual(['c1', 'c2']);
  });

  it('drops a tail response that started before a window rewrite', async () => {
    const tail = deferred<ReturnType<typeof page>>();
    const rewrite = deferred<ReturnType<typeof page>>();
    const responses = [tail.promise, rewrite.promise];
    let call = 0;
    const getSessionMessages = vi.fn(async () => responses[call++]);
    const { view, value } = await mountTranscript({ s: [textRecord('a1')] }, getSessionMessages);

    const tailRefresh = value.refreshMessages('s');
    const rewriteRefresh = value.refreshMessages('s', true, { mode: 'replace' });

    rewrite.resolve(page([textRecord('z1')]));
    await rewriteRefresh;
    expect(ids(view.messages())).toEqual(['z1']);

    tail.resolve(page([textRecord('a1'), textRecord('a2')]));
    await tailRefresh;
    expect(ids(view.messages())).toEqual(['z1']);
  });
});
