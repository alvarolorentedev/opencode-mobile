import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrefixFetch, createScopedFetch, fetchConnection, getRequestHeaders } from '@/shared/protocol/opencode/client/fetch';

// The OIDC session is mocked at the module boundary: this suite covers the
// transport contract (token header, basic-auth coexistence and one replay after
// a rejection), not the browser flow or the token store.
const session = vi.hoisted(() => ({
  getOidcAccessToken: vi.fn(async () => 'access-token-1'),
  refreshOidcSession: vi.fn(async () => 'access-token-2'),
}));
vi.mock('@/shared/auth/oidc/session', () => session);
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => (globalThis.fetch as typeof fetch)(...(args as [RequestInfo, RequestInit])) }));
vi.mock('@/shared/network/data-usage', () => ({ recordBytes: vi.fn(), recordRequest: vi.fn() }));
vi.mock('@/shared/network/request-stats', () => ({ recordRequestStart: () => () => {} }));
vi.mock('@/shared/observability/client', () => ({
  telemetry: { warn: vi.fn() },
}));
vi.mock('@/shared/contracts/cloud-link', () => ({ getConnectCredentialError: () => undefined }));
vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('@/shared/platform/tls-trust', () => ({ ensureConnectionTrust: async () => {} }));

const basic = `Basic ${Buffer.from('alice:secret').toString('base64')}`;
const oidc = { issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token' };
const settings = { serverUrl: 'https://server', username: 'alice', password: 'secret', directory: '', headers: { 'CF-Access-Client-Id': 'client' }, oidc };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sentHeaders(transport: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(transport.mock.calls[index]?.[1]?.headers as HeadersInit);
}

beforeEach(() => {
  session.getOidcAccessToken.mockReset().mockResolvedValue('access-token-1');
  session.refreshOidcSession.mockReset().mockResolvedValue('access-token-2');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('OpenID Connect transport authorization', () => {
  it('keeps basic auth and adds the raw token in its own header', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await fetchConnection('https://server/api/info', { headers: { Accept: 'application/json' } }, settings);
    const headers = sentHeaders(transport, 0);
    expect(headers.get('authorization')).toBe(basic);
    expect(headers.get('x-auth-request-access-token')).toBe('access-token-1');
    expect(headers.get('cf-access-client-id')).toBe('client');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('uses Bearer only when the connection has no password, and honors a custom token header', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await fetchConnection('https://server/api/info', undefined, {
      ...settings,
      password: '',
      oidc: { ...oidc, tokenHeader: 'X-Access-Token' },
    });
    const headers = sentHeaders(transport, 0);
    expect(headers.get('authorization')).toBe('Bearer access-token-1');
    expect(headers.get('x-access-token')).toBe('access-token-1');
    expect(headers.get('x-auth-request-access-token')).toBeNull();
  });

  it('refreshes once after a 401 and replays the read with the new token', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    session.getOidcAccessToken
      .mockResolvedValueOnce('access-token-1')
      .mockResolvedValue('access-token-2');
    const response = await fetchConnection('https://server/api/info', undefined, settings);
    expect(response.status).toBe(200);
    expect(session.refreshOidcSession).toHaveBeenCalledOnce();
    expect(sentHeaders(transport, 0).get('authorization')).toBe(basic);
    expect(sentHeaders(transport, 0).get('x-auth-request-access-token')).toBe('access-token-1');
    expect(sentHeaders(transport, 1).get('authorization')).toBe(basic);
    expect(sentHeaders(transport, 1).get('x-auth-request-access-token')).toBe('access-token-2');
  });

  it('surfaces sign-in required when the refresh token is dead', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ error: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', transport);
    session.refreshOidcSession.mockRejectedValue(new Error('Sign in with OpenID Connect to use this server.'));
    await expect(fetchConnection('https://server/api/info', undefined, settings)).rejects.toThrow(/Sign in with OpenID Connect/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('leaves basic-auth connections untouched', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await fetchConnection('https://server/api/info', undefined, { serverUrl: 'http://server', username: 'alice', password: 'secret', directory: '' });
    expect(session.getOidcAccessToken).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
});

describe('OIDC destination and replay protection', () => {
  it.each(['https://evil.test/api/info', 'http://server/api/info', 'https://server.evil.test/api/info', 'https://user:private@server/api/info'])('rejects destination %s before resolving credentials', async (url) => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    await expect(fetchConnection(url, undefined, settings)).rejects.toThrow(/configured secure server/);
    expect(session.getOidcAccessToken).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('guards both SDK scoped transports and the configured proxy mount', async () => {
    vi.stubGlobal('fetch', vi.fn());
    for (const scoped of [createScopedFetch('https://server', '/proxy', '/repo', { ...settings, serverUrl: 'https://server/proxy' }),
      createPrefixFetch('https://server', '/proxy', { ...settings, serverUrl: 'https://server/proxy' })]) {
      await expect(scoped('https://evil.test/api/info')).rejects.toThrow();
    }
    await expect(fetchConnection('https://server/unrelated', undefined, { ...settings, serverUrl: 'https://server/proxy' })).rejects.toThrow();
    expect(session.getOidcAccessToken).not.toHaveBeenCalled();
  });
  it('sets redirect rejection even if a caller requests follow, and keeps Basic app-owned', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({})); vi.stubGlobal('fetch', transport);
    await fetchConnection(new Request('https://server/api/info', { headers: { Accept: 'application/json', authorization: 'Bearer untrusted' } }), { redirect: 'follow' }, settings);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(sentHeaders(transport, 0).get('authorization')).toBe(basic);
    expect(sentHeaders(transport, 0).get('accept')).toBe('application/json');
  });
  it.each([401, 403])('replays at most once for status %s and passes the rejected token', async (status) => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({}, status)); vi.stubGlobal('fetch', transport);
    const result = await fetchConnection('https://server/api/info', undefined, settings);
    expect(result.status).toBe(status); expect(transport).toHaveBeenCalledTimes(2);
    expect(session.refreshOidcSession).toHaveBeenCalledExactlyOnceWith(settings, oidc, 'access-token-1');
  });
  it('replays a string POST once, preserving the body', async () => {
    const transport = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({})); vi.stubGlobal('fetch', transport);
    await fetchConnection('https://server/api/session', { method: 'POST', body: '{"prompt":"hello"}' }, settings);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][1].body).toBe('{"prompt":"hello"}');
  });
  it.each(['form', 'request', 'request-null-body'])('does not replay an unsafe %s body', async (kind) => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({}, 401)); vi.stubGlobal('fetch', transport);
    const result = kind === 'form'
      ? await fetchConnection('https://server/api/session', { method: 'POST', body: new FormData() }, settings)
      : await fetchConnection(new Request('https://server/api/session', { method: 'POST', body: 'stream' }), kind === 'request-null-body' ? { body: null } : undefined, settings);
    expect(result.status).toBe(401); expect(transport).toHaveBeenCalledOnce();
  });
});

describe('legacy connection regression protection', () => {
  it.each([
    { name: 'plain', password: '', headers: undefined },
    { name: 'Basic', password: 'secret', headers: undefined },
    { name: 'gateway', password: '', headers: { 'X-Gateway': 'gateway' } },
    { name: 'Basic and gateway', password: 'secret', headers: { 'X-Gateway': 'gateway' } },
    { name: 'custom CA', password: 'secret', headers: { 'X-Gateway': 'gateway' }, certificate: { pem: 'test-ca' } },
  ])('retains HTTP and caller headers for $name without loading OIDC', async ({ name: _name, ...config }) => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({})); vi.stubGlobal('fetch', transport);
    const legacy = { serverUrl: 'http://server', username: 'alice', directory: '', ...config } as Parameters<typeof fetchConnection>[2];
    const headers = getRequestHeaders(legacy!);
    await fetchConnection('http://server/api/info', { headers }, legacy);
    expect(transport.mock.calls[0]?.[1]?.headers).toEqual(headers);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBeUndefined();
    expect(session.getOidcAccessToken).not.toHaveBeenCalled(); expect(session.refreshOidcSession).not.toHaveBeenCalled();
  });
});

it('does not disclose credentials to an actual HTTP redirect destination', async () => {
  let leaked = 0;
  const destination = createServer((_request, response) => { leaked++; response.end('unexpected'); });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
  const destinationPort = (destination.address() as { port: number }).port;
  const source = createServer((_request, response) => { response.writeHead(307, { Location: `http://127.0.0.1:${destinationPort}/capture` }); response.end(); });
  await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  try {
    await expect(fetchConnection(`${serverUrl}/api/info`, undefined, { ...settings, serverUrl })).rejects.toThrow();
    expect(leaked).toBe(0);
  } finally {
    source.closeAllConnections(); destination.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => source.close(() => resolve())), new Promise<void>((resolve) => destination.close(() => resolve()))]);
  }
});
