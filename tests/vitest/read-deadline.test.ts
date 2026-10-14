import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCode } from '@opencode/client';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { createAuthHeader, createPrefixFetch, createScopedFetch, fetchConnection } from '@/lib/opencode/client/fetch';
import { READ_TIMEOUT_MS } from '@/lib/opencode/client/read-deadline';
import { coalesceRead } from '@/lib/opencode/in-flight';
import { normalizeServerUrl } from '@/lib/opencode/client/url';
import { deferred } from '../helpers/runtime.mjs';

const counters = vi.hoisted(() => ({ recordBytes: vi.fn(), recordRequest: vi.fn() }));
vi.mock('@/lib/opencode/data-usage', () => counters);
vi.mock('@/lib/connect', () => ({ getConnectCredentialError: () => undefined }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('expo/fetch', () => ({ fetch: (...args: any[]) => (globalThis.fetch as any)(...args) }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('finite SDK reads', () => {
  it.each(['v1', 'v2'])('expires stalled %s headers, releases coalescing and rejects late commits', async (contract) => {
    const gate = deferred(), transport = vi.fn().mockReturnValueOnce(gate.promise).mockImplementation(async () => new Response(contract === 'v1' ? '[]' : '{"data":[]}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', transport);
    const scoped = createPrefixFetch('http://server', '');
    const client = contract === 'v1'
      ? createOpencodeClient({ baseUrl: 'http://server', fetch: scoped, responseStyle: 'fields', throwOnError: true })
      : OpenCode.make({ baseUrl: 'http://server', fetch: scoped });
    let commits = 0;
    const read = () => coalesceRead(client, 'permissions', async () => {
      const result = contract === 'v1' ? await (client as any).permission.list() : await (client as any).permission.request.list({ location: { directory: '/repo' } });
      commits++; return result;
    });
    const pending = read(), same = read();
    expect(same).toBe(pending);
    const failed = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS); await failed;
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
    gate.resolve(new Response(contract === 'v1' ? '[]' : '{"data":[]}', { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve(); expect(commits).toBe(0);
    await read(); expect(commits).toBe(1); expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each(['v1', 'v2'])('keeps the %s deadline alive through body consumption', async (contract) => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { 'content-type': 'application/json' } })));
    const scoped = createPrefixFetch('http://server', '');
    const client = contract === 'v1' ? createOpencodeClient({ baseUrl: 'http://server', fetch: scoped, throwOnError: true }) : OpenCode.make({ baseUrl: 'http://server', fetch: scoped });
    const pending = contract === 'v1' ? (client as any).permission.list() : (client as any).permission.request.list({ location: { directory: '/repo' } });
    const failed = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS); await failed;
    body.enqueue(new TextEncoder().encode(contract === 'v1' ? '[]' : '{"data":[]}')); body.close();
  });
  it('propagates a caller signal through Request-based wrappers and removes completed deadlines', async () => {
    const transport = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', transport);
    const controller = new AbortController();
    const response = await createScopedFetch('http://server', '/proxy', '/repo')(new Request('http://server/session'), { signal: controller.signal });
    await response.json();
    expect(transport.mock.calls[0][0]).toBe('http://server/proxy/session?directory=%2Frepo');
    expect(vi.getTimerCount()).toBe(0);
    controller.abort(); expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });
  it('leaves SSE and mutation lifecycles unchanged', async () => {
    const gate = deferred(), transport = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', transport);
    const stream = fetchConnection('http://server/api/event');
    const mutation = fetchConnection('http://server/api/session/s/message', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 2);
    expect(vi.getTimerCount()).toBe(0); expect(transport.mock.calls.every(([, options]) => !options?.signal)).toBe(true);
    gate.resolve(new Response(null)); await Promise.all([stream, mutation]);
  });
});

describe('credential and diagnostic boundaries', () => {
  it('preserves exact UTF-8 passwords and rejects embedded URL credentials', () => {
    const password = ' 漢字 🔑 ';
    const header = createAuthHeader({ serverUrl: 'http://server', username: ' alice ', password, directory: '' });
    expect(Buffer.from(header!.slice(6), 'base64').toString('utf8')).toBe(`alice:${password}`);
    expect(createAuthHeader({ serverUrl: '', username: '', password: ' ', directory: '' })).toBe(`Basic ${Buffer.from('opencode: ').toString('base64')}`);
    expect(normalizeServerUrl('http://alice:private@server').valid).toBe(false);
  });
  it('counts advertised bytes without cloning unknown-size responses', async () => {
    const response = new Response('large unknown body');
    const clone = vi.spyOn(response, 'clone');
    vi.stubGlobal('fetch', vi.fn(async () => response));
    expect(await (await fetchConnection('http://server/session')).text()).toBe('large unknown body');
    expect(clone).not.toHaveBeenCalled(); expect(counters.recordBytes).not.toHaveBeenCalled();
    response.headers.set('content-length', '42');
    await fetchConnection('http://server/session');
    expect(counters.recordBytes).toHaveBeenCalledWith(42); expect(counters.recordRequest).toHaveBeenCalledTimes(2);
  });
});
