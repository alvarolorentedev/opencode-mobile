import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchConnection } from '@/shared/protocol/opencode/client/fetch';

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
  telemetry: {
    startSpan: () => ({ end: vi.fn() }),
    histogram: vi.fn(),
    counter: vi.fn(),
    logWithSpan: vi.fn(),
  },
}));
vi.mock('@/shared/contracts/cloud-link', () => ({ getConnectCredentialError: () => undefined }));
vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('@/shared/platform/tls-trust', () => ({ ensureConnectionTrust: async () => {} }));

const basic = `Basic ${Buffer.from('alice:secret').toString('base64')}`;
const oidc = { issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token' };
const settings = { serverUrl: 'http://server', username: 'alice', password: 'secret', directory: '', headers: { 'CF-Access-Client-Id': 'client' }, oidc };
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
    await fetchConnection('http://server/api/info', { headers: { Accept: 'application/json' } }, settings);
    const headers = sentHeaders(transport, 0);
    expect(headers.get('authorization')).toBe(basic);
    expect(headers.get('x-auth-request-access-token')).toBe('access-token-1');
    expect(headers.get('cf-access-client-id')).toBe('client');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('uses Bearer only when the connection has no password, and honors a custom token header', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await fetchConnection('http://server/api/info', undefined, {
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
    const response = await fetchConnection('http://server/api/info', undefined, settings);
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
    await expect(fetchConnection('http://server/api/info', undefined, settings)).rejects.toThrow(/Sign in with OpenID Connect/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('leaves basic-auth connections untouched', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await fetchConnection('http://server/api/info', undefined, { serverUrl: 'http://server', username: 'alice', password: 'secret', directory: '' });
    expect(session.getOidcAccessToken).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
});
