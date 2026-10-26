import { base64 } from '@scure/base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isContractMismatchError } from '@/lib/opencode/client/errors';
import { fetchConnection } from '@/lib/opencode/client/fetch';
import { detectServerContract, probeConnection } from '@/lib/opencode/client/probe';
import { getServerHostname } from '@/lib/opencode/client/url';
import { parseLocalPairing, resolveLocalPairing } from '@/lib/opencode/pairing';
import * as readDeadline from '@/lib/opencode/client/read-deadline';
import { loadTs } from '../helpers/runtime.mjs';

vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } }));
vi.mock('@/lib/opencode/client/fetch', () => ({
  fetchConnection: vi.fn(),
  getRequestHeaders: (settings: { password: string; username: string }) => settings.password ? { Authorization: `Basic ${Buffer.from(`${settings.username || 'opencode'}:${settings.password}`).toString('base64')}` } : undefined,
}));

const fetchMock = vi.mocked(fetchConnection);
const settings = { serverUrl: 'http://example.test', username: '', password: '', directory: '' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('connection setup probe', () => {
  it('keeps V1 authoritative when compatibility routes look like V2', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/global/health') ? json({ version: '1.18.3' }) : json({ version: '2.0.16', pid: 1 }));
    expect(await probeConnection(settings)).toEqual({ status: 'detected', contract: 'v1', version: '1.18.3' });
  });
  it('probes V2 under a proxy prefix and authenticates with the default username', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/api/info') ? json({ version: '2.0.16', urls: [] }) : json({}, 404));
    expect(await probeConnection({ ...settings, serverUrl: 'http://example.test/proxy/api', password: 'secret' })).toMatchObject({ status: 'detected', contract: 'v2' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.test/proxy/api/info');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: `Basic ${Buffer.from('opencode:secret').toString('base64')}` });
  });
  it('preserves authentication uncertainty while retaining the connect-time fallback', async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    expect(await probeConnection(settings)).toEqual({ status: 'authentication-required' });
    expect(await detectServerContract(settings)).toEqual({ contract: 'v2' });
  });
  it('separates reachable unknown responses from unreachable servers', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Web UI</html>', { headers: { 'content-type': 'text/html' } }));
    expect(await probeConnection(settings)).toEqual({ status: 'unknown' });
    fetchMock.mockRejectedValue(new Error('Network unavailable'));
    expect(await probeConnection(settings)).toEqual({ status: 'unreachable' });
  });
  it('aborts all outstanding requests on cancellation', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))));
    const pending = probeConnection(settings, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: 'unreachable' });
    expect(fetchMock.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });
  it.each([[' https://EXAMPLE.com:443/proxy/api ', 'example.com'], ['192.168.1.10:49374', '192.168.1.10'], ['http://[fd00::1]:49374', '[fd00::1]']])('uses the hostname of %s for default names', (url, hostname) => {
    expect(getServerHostname(url)).toBe(hostname);
  });
});

describe('local pairing', () => {
  it('preserves Cloudflare startup errors before SDK parsing, while auth denials and manual transport stay actionable', async () => {
    const transport = await loadTs('lib/opencode/client/fetch.ts', {
      './read-deadline': readDeadline, '@scure/base': { base64 }, 'expo/fetch': { fetch: async () => response },
      '../data-usage': { recordBytes: () => {}, recordRequest: () => {} },
      '../request-stats': { recordRequestStart: () => () => {} },
      './request-policy': { getRequestTimeout: () => 30_000, shouldRetryRead: () => false },
      '@/lib/connect': { getConnectCredentialError: () => undefined }, './url': {},
    }, { fetch: async () => response });
    const html = (status: number) => new Response('<html>Cloudflare Error 1033</html>', { status, headers: { 'content-type': 'text/html' } });
    let response = html(530);
    const cloudSettings = { ...settings, connect: {} };
    await expect(transport.fetchConnection('https://machine.test', {}, cloudSettings)).rejects.toThrow('1033');
    for (const status of [401, 403]) {
      response = html(status);
      await expect(transport.fetchConnection('https://machine.test', {}, cloudSettings)).rejects.toThrow(status === 401 ? 'credentials were rejected' : 'access was denied');
    }
    response = html(530);
    expect(await (await transport.fetchConnection('http://manual.test')).text()).toContain('1033');
  });
  it('uses redirect-aware native transport for redemption while preserving normal manual transport', async () => {
    const manualFetch = vi.fn(async () => json({}));
    const nativeFetch = vi.fn(async () => json({}));
    const transport = await loadTs('lib/opencode/client/fetch.ts', {
      './read-deadline': readDeadline, '@scure/base': { base64 }, 'expo/fetch': { fetch: nativeFetch },
      '../data-usage': { recordBytes: () => {}, recordRequest: () => {} },
      '../request-stats': { recordRequestStart: () => () => {} },
      './request-policy': { getRequestTimeout: () => 30_000, shouldRetryRead: () => false },
      '@/lib/connect': { getConnectCredentialError: () => undefined }, './url': {},
    }, { fetch: manualFetch });
    await transport.fetchConnection('http://example.test/api/info');
    await transport.fetchConnection('http://example.test/auth/connect/code', { redirect: 'error' });
    expect(manualFetch).toHaveBeenCalledOnce();
    expect(nativeFetch).toHaveBeenCalledWith('http://example.test/auth/connect/code', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it.each([
    JSON.stringify({ urls: ['http://192.168.1.10:49374'], code: 'one-use-code' }),
    'http://192.168.1.10:49374/auth/connect/one-use-code',
  ])('parses current codes and links without retaining the code in a server URL', (code) => {
    expect(parseLocalPairing(code)).toEqual({ urls: ['http://192.168.1.10:49374'], code: 'one-use-code' });
  });
  it.each(['#', '?data='])('parses encoded legacy credential links using %s', (separator) => {
    const code = `http://192.168.1.10:49374/connect${separator}${Buffer.from(JSON.stringify({ username: 'opencode', password: 'secret' })).toString('base64')}`;
    expect(parseLocalPairing(code)).toEqual({ urls: ['http://192.168.1.10:49374'], password: 'secret' });
  });
  it('accepts legacy credential JSON and de-duplicates addresses', () => {
    expect(parseLocalPairing(JSON.stringify({ username: 'opencode', password: 'secret', urls: ['http://example.test/', 'http://example.test'] }))).toEqual({ urls: ['http://example.test'], password: 'secret' });
  });
  it('preserves UTF-8 passwords in legacy links', () => {
    const secret = { username: 'opencode', password: 'contraseña 🔑' };
    expect(parseLocalPairing(`http://example.test/connect#${Buffer.from(JSON.stringify(secret)).toString('base64')}`)).toEqual({ urls: ['http://example.test'], password: secret.password });
  });
  it('preserves proxy prefixes while removing legacy credential data', () => {
    const encoded = Buffer.from(JSON.stringify({ username: 'opencode', password: 'secret' })).toString('base64url');
    expect(parseLocalPairing(`https://example.test/proxy/connect#${encoded}`)).toEqual({ urls: ['https://example.test/proxy'], password: 'secret' });
    expect(parseLocalPairing('https://example.test/proxy/auth/connect/code')).toEqual({ urls: ['https://example.test/proxy'], code: 'code' });
  });
  it.each(['{}', '{', 'https://example.test', 'https://example.test/auth/connect/x?secret=y', JSON.stringify({ code: 'x', urls: ['file:///tmp'] }), JSON.stringify({ code: 'x', urls: ['http://user:secret@example.test'] }), JSON.stringify({ code: '../x', urls: ['http://example.test'] }), JSON.stringify({ username: 'alice', password: 'secret', urls: ['http://example.test'] }), 'x'.repeat(17000)])('rejects invalid payloads before requests', async (code) => {
    await expect(resolveLocalPairing(code)).rejects.toMatchObject({ reason: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('skips loopback and tries distinct addresses in order with JSON redemption', async () => {
    fetchMock.mockImplementation(async (url) => { if (String(url).includes('unreachable')) throw new Error('Network'); return json({ token: 'session-token' }); });
    const result = await resolveLocalPairing(JSON.stringify({ code: 'one-use-code', urls: ['http://127.0.0.1', 'http://unreachable.test', 'http://example.test', 'http://example.test'] }));
    expect(result).toEqual({ ...settings, password: 'session-token' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://unreachable.test/auth/connect/one-use-code', 'http://example.test/auth/connect/one-use-code']);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { Accept: 'application/json' }, redirect: 'error' });
  });
  it('bounds each address attempt to five seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')))));
    const pending = expect(resolveLocalPairing(JSON.stringify({ code: 'x', urls: ['http://example.test'] }))).rejects.toMatchObject({ reason: 'unreachable' });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });
  it('distinguishes expired, unreachable and loopback-only codes', async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    const payload = (urls: string[]) => JSON.stringify({ code: 'x', urls });
    await expect(resolveLocalPairing(payload(['http://example.test']))).rejects.toMatchObject({ reason: 'expired' });
    fetchMock.mockRejectedValue(new Error('Network'));
    await expect(resolveLocalPairing(payload(['http://example.test']))).rejects.toMatchObject({ reason: 'unreachable' });
    fetchMock.mockClear();
    await expect(resolveLocalPairing(payload(['http://localhost.', 'http://127.0.0.2', 'http://[::1]', 'http://[::ffff:127.0.0.1]']))).rejects.toMatchObject({ reason: 'loopback' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('verifies legacy credentials before choosing an address', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/api/info') ? json({ version: '2.0.16', pid: 1 }) : json({}, 404));
    expect(await resolveLocalPairing(JSON.stringify({ urls: ['http://example.test'], username: 'opencode', password: 'legacy-secret' }))).toMatchObject({ serverUrl: 'http://example.test', username: '', password: 'legacy-secret' });
  });
});


describe('protocol fallback classification', () => {
  it('tries another contract only for a missing endpoint or malformed protocol', () => {
    for (const status of [404, 405]) expect(isContractMismatchError(Object.assign(new Error('request failed'), { status }))).toBe(true);
    for (const status of [401, 403, 429, 500, 503]) expect(isContractMismatchError(Object.assign(new Error('request failed'), { status }))).toBe(false);
    for (const message of ['fetch failed', 'Network unavailable', 'UnexpectedStatus: 401', 'text/html 503', 'connection timed out']) expect(isContractMismatchError(new Error(message))).toBe(false);
    expect(isContractMismatchError(new Error('MalformedResponse'))).toBe(true);
    expect(isContractMismatchError(new Error('UnexpectedStatus'))).toBe(false);
  });
});

describe('native defaults', () => {
  it('recognizes affirmative v1 versions on known /api compatibility routes', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/api/health') ? json({ healthy: true, version: '1.18.34' }) : json({}, 404));
    expect(await probeConnection(settings)).toMatchObject({ status: 'detected', contract: 'v1' });
    fetchMock.mockResolvedValue(json({}));
    expect(await detectServerContract(settings)).toEqual({ contract: 'v2' });
  });
  it('constructs native clients and PTY URLs unless compatibility is explicit', async () => {
    const native = vi.fn(() => ({ api: {} }));
    const legacy = vi.fn(() => ({}));
    const urls = await loadTs('lib/opencode/client/url.ts', { './types': { defaultConnectionSettings: settings } });
    const client = await loadTs('lib/opencode/client.ts', {
      './compat/v1/client': { buildV1Compatibility: legacy }, './v2-client': { buildV2Client: native },
      './client/types': {}, './client/url': urls, './client/fetch': {}, './client/errors': {}, './client/probe': {}, './client/interactions': {}, './client/management': {}, './client/management-api': {},
    });
    const connection = { ...settings, directory: '/repo', serverUrl: 'https://test/proxy/api' };
    client.buildClient(connection); expect(native).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled();
    expect(client.buildPtyWebSocketUrl(connection, 'p')).toBe('wss://test/proxy/api/pty/p/connect?location%5Bdirectory%5D=%2Frepo');
    client.buildClient(connection, 'v1'); expect(legacy).toHaveBeenCalledOnce();
  });
});

describe('installed native SDK error boundary', () => {
  it('retains actionable status through SDK transport wrapping', async () => {
    const { OpenCode } = await import('@opencode/client');
    let status = 404;
    const raw = await loadTs('lib/opencode/v2/raw.ts', {
      '@opencode/client': { OpenCode },
      '../client': { getRequestHeaders: () => ({}), createPrefixFetch: () => async () => json({ error: 'Request denied' }, status) },
      './shared': { resolveV2Base: () => ({ base: { origin: 'http://test' }, pathPrefix: '' }) },
    }, { Error });
    const api = raw.buildV2Raw(settings).api;
    for (status of [404, 405, 401, 403, 500, 503]) {
      try { await api.location.get(); throw new Error('Request unexpectedly succeeded'); }
      catch (error) {
        expect(isContractMismatchError(error)).toBe(status === 404 || status === 405);
        expect((error as Error).message).toContain(`(${status})`);
      }
    }
  });
});
