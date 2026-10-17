import { describe, it, expect, vi } from 'vitest';

import { buildV2Client } from '@/lib/opencode/v2-client';
import { coalesceRead } from '@/lib/opencode/in-flight';
import {
  getSessionMessages,
  getSessionDiff,
  listSessions,
  listArchivedSessions,
} from '@/providers/services/session-service';

// The SDK entrypoint and the app's client helper are replaced with the test's
// own API/client doubles; `../client` and `./client` resolve to the same file
// id as the alias, so `buildV2Client` uses the stubbed helpers.
const h = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock('@opencode/client', () => ({ OpenCode: { make: () => h.api } }));
vi.mock('@/lib/opencode/client', () => ({
  getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }),
  getRequestHeaders: () => ({}),
  createPrefixFetch: () => () => {},
}));

function deferred() {
  let resolve: (value: unknown) => void, reject: (reason?: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: resolve!, reject: reject! };
}

const history = Array.from({ length: 4300 }, (_, i) => ({ id: `m-${i}`, type: 'user', text: `Message ${i}`, time: { created: i } }));
let messageCalls = 0;
let listCalls = 0;
const api = {
  message: { async list({ sessionID, limit, cursor, order }: any) {
    expect(sessionID).toBe('s');
    expect(limit).toBe(20);
    if (cursor) expect(order).toBeUndefined();
    else expect(order).toBe('desc');
    messageCalls++;
    const offset = cursor ? Number(cursor) : 0;
    const newest = [...history].reverse();
    return { data: newest.slice(offset, offset + limit), cursor: { next: offset + limit < newest.length ? String(offset + limit) : null } };
  } },
  session: {
    async list() { listCalls++; await Promise.resolve(); return { data: [{ id: 's', time: { created: 0, updated: 1 }, location: { directory: '/repo' } }] }; },
    async active() { return { s: {} }; },
    async diff({ from }: any) { expect(from).toBe('m-4299'); return []; },
  },
};
h.api = api;
const client = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);

describe('session reads', () => {
  it('shares one outstanding newest-page read and pages with the cursor', async () => {
    // A cold transcript read and the diff fallback share one outstanding newest page.
    const [page] = await Promise.all([getSessionMessages(client, 's'), getSessionDiff(client, 's')]);
    expect(messageCalls).toBe(1);
    expect(page.records.length).toBe(20);
    expect(page.records[0].info.id).toBe('m-4280');
    expect(page.records.at(-1)!.info.id).toBe('m-4299');
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe('20');

    await listSessions(client);
    expect(listCalls).toBe(1);

    await getSessionMessages(client, 's');
    expect(messageCalls).toBe(2);

    const olderPage = await getSessionMessages(client, 's', { before: page.nextBefore });
    expect(messageCalls).toBe(3);
    expect(olderPage.records.length).toBe(20);
    expect(olderPage.records[0].info.id).toBe('m-4260');
    expect(olderPage.records.at(-1)!.info.id).toBe('m-4279');
  });

  it('pages V1 chronologically through its header cursor', async () => {
    const v1Client: any = { session: { async messages({ limit, before }: any) {
      expect(limit).toBe(20);
      const end = before ? Number(before) : history.length;
      const start = Math.max(0, end - limit);
      return { data: history.slice(start, end).map((m) => ({ info: { id: m.id, role: 'user' }, parts: [] })), response: { headers: new Headers(start ? { 'x-next-cursor': String(start) } : {}) } };
    } } };
    const v1 = await getSessionMessages({ compatibility: v1Client } as any, 's');
    expect(v1.records.length).toBe(20);
    expect(v1.records[0].info.id).toBe('m-4280');
    expect(v1.records.at(-1)!.info.id).toBe('m-4299');
    expect(v1.nextBefore).toBe('4280');
  });

  it('does not report idle when the V2 active-session read fails', async () => {
    const active = vi.spyOn(api.session, 'active').mockRejectedValueOnce(new Error('offline'));
    await expect(listSessions(client)).rejects.toThrow('offline');
    active.mockResolvedValueOnce(undefined as never);
    await expect(listSessions(client)).rejects.toThrow('did not return active sessions');
    active.mockRestore();
  });

  it('lists every V2 session page instead of only the first', async () => {
    const page = (id: string, updated: number, next: string | null) => ({
      data: [{ id, time: { created: 0, updated }, location: { directory: '/repo' } }],
      cursor: { next },
    });
    const cursors: unknown[] = [];
    const previous = h.api;
    h.api = {
      session: {
        list: async ({ cursor }: { cursor?: string }) => {
          cursors.push(cursor);
          return cursor === undefined ? page('newest', 3, 'page-2') : page('older', 2, null);
        },
        active: async () => ({}),
      },
    };
    const pagedClient = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);
    const result = await listSessions(pagedClient);
    h.api = previous;
    expect(cursors).toEqual([undefined, 'page-2']);
    expect(Array.from(result.sessions, (session: any) => session.id)).toEqual(['newest', 'older']);
    expect(result.statuses).toEqual({ newest: { type: 'idle' }, older: { type: 'idle' } });
  });

  it('stops V2 paging when a page repeats its own cursor or adds nothing', async () => {
    const repeated = [{ id: 'looping', time: { created: 0, updated: 1 }, location: { directory: '/repo' } }];
    let reads = 0;
    const previous = h.api;
    h.api = {
      session: {
        list: async () => { reads += 1; return { data: repeated, cursor: { next: 'same' } }; },
        active: async () => ({}),
      },
    };
    const loopingClient = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);
    const result = await listSessions(loopingClient);
    h.api = previous;
    // The first page is kept, the second repeats it, and paging stops there.
    expect(reads).toBe(2);
    expect(Array.from(result.sessions, (session: any) => session.id)).toEqual(['looping']);
  });

  it('rejects a malformed V2 session list response', async () => {
    const previous = h.api;
    h.api = { session: { list: async () => ({ data: null, cursor: { next: null } }), active: async () => ({}) } };
    const malformedClient = buildV2Client({ serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never);
    const failure = await listSessions(malformedClient).then(() => undefined, (error: Error) => error);
    h.api = previous;
    expect(failure?.message).toContain('did not return its session list');
  });

  it('coalesces outstanding reads per client scope and never caches settled ones', async () => {
    const old: any = {}, next: any = {};
    const slow = deferred();
    let reads = 0;
    const read = () => { reads++; return slow.promise as Promise<never[]>; };
    const a = coalesceRead(old, 'messages:s', read);
    const b = coalesceRead(old, 'messages:s', read);
    expect(a).toBe(b);
    const other = coalesceRead(next, 'messages:s', read);
    await Promise.resolve();
    expect(reads).toBe(2);
    slow.resolve([]);
    await Promise.all([a, other]);
    await expect(coalesceRead(old, 'failure', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(coalesceRead(old, 'failure', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('lists archived sessions across V1 cursor pages', async () => {
    const activeSession = { id: 'active', time: { updated: 3 } };
    const archivedSession = { id: 'archive', time: { updated: 2, archived: 10 } };
    const restoredSession = { id: 'restored', time: { updated: 1, archived: 0 } };
    const cursors: unknown[] = [];
    const mixedClient: any = {
      session: {
        list: async () => ({ data: [archivedSession, restoredSession, activeSession] }),
        status: async () => ({ data: {} }),
      },
      experimental: { session: { list: async ({ archived, cursor }: any) => {
        expect(archived).toBe(true);
        cursors.push(cursor);
        return cursor === undefined
          ? { data: [activeSession], response: { headers: new Headers({ 'x-next-cursor': '2' }) } }
          : { data: [archivedSession, restoredSession], response: { headers: new Headers() } };
      } } },
    };
    expect(Array.from(await listArchivedSessions({ compatibility: mixedClient } as any), (s: any) => s.id)).toEqual(['archive']);
    expect(cursors).toEqual([undefined, 2]);
    expect(Array.from((await listSessions({ compatibility: mixedClient } as any)).sessions, (s: any) => s.id)).toEqual(['active', 'restored']);
  });
});

describe('native background completion checks', () => {
  it('does not mistake retry, inbox or approvals for completion and propagates read failures', async () => {
    const { hasPendingSessionWork } = await import('@/providers/services/session-service');
    const api: any = {
      message: { list: vi.fn(async () => ({ data: [{ type: 'assistant', retry: { attempt: 2 } }] })) },
      session: { inbox: { list: vi.fn(async () => []) } },
      permission: { request: { list: vi.fn(async () => ({ data: [] })) } },
      form: { list: vi.fn(async () => ({ data: [] })) },
    };
    const client = { api, __opencode: { directory: '/repo' } } as never;
    expect(await hasPendingSessionWork(client, 's')).toBe(true);
    api.message.list.mockResolvedValue({ data: [{ type: 'idle' }, { type: 'assistant', retry: {} }] });
    expect(await hasPendingSessionWork(client, 's')).toBe(false);
    api.session.inbox.list.mockResolvedValue([{}]);
    expect(await hasPendingSessionWork(client, 's')).toBe(true);
    api.session.inbox.list.mockResolvedValue([]);
    api.permission.request.list.mockResolvedValue({ data: [{ sessionID: 's' }] });
    expect(await hasPendingSessionWork(client, 's')).toBe(true);
    api.permission.request.list.mockResolvedValue({ data: [] });
    api.form.list.mockResolvedValue({ data: [{ sessionID: 'global' }] });
    expect(await hasPendingSessionWork(client, 's')).toBe(true);
    api.form.list.mockRejectedValue(new Error('offline'));
    await expect(hasPendingSessionWork(client, 's')).rejects.toThrow('offline');
    expect(await hasPendingSessionWork({ compatibility: {} } as never, 's')).toBe(false);
  });
});
