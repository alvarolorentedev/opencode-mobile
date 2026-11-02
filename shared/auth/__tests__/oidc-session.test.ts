import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOidcAccessToken, getOidcSessionStatus, oidcSessionKeyFor, refreshOidcSession, resetOidcSessionCache, signInWithOidc, signOutOidc } from '@/shared/auth/oidc/session';
import { OidcAuthError } from '@/shared/auth/oidc/errors';
import type { OidcTokenSet } from '@/shared/storage/connection-oidc';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), remove: vi.fn(), authorize: vi.fn() }));
vi.mock('@/shared/storage/connection-oidc', () => ({ readOidcTokens: mocks.read, saveOidcTokens: mocks.save, deleteOidcTokens: mocks.remove }));
vi.mock('@/shared/auth/oidc/flow', () => ({ runOidcAuthorization: mocks.authorize }));
vi.mock('@/shared/auth/oidc/discovery', () => ({ discoverOidc: async () => ({ tokenEndpoint: 'https://idp.test/token' }) }));
vi.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));
vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));

const identity = { serverUrl: 'https://server.test', username: 'alice' };
const oidc = { issuer: 'https://idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'X-Token' };
const token = (accessToken = 'initial', refreshToken: string | undefined = 'refresh'): OidcTokenSet => ({ accessToken, refreshToken, expiresAt: Date.now() + 3600_000, tokenType: 'Bearer', issuer: oidc.issuer, clientId: oidc.clientId });
const disk = new Map<string, OidcTokenSet>();
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (access = 'renewed', refresh?: string) => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 3600 }));

beforeEach(() => {
  resetOidcSessionCache(); disk.clear(); vi.clearAllMocks();
  mocks.read.mockImplementation(async (key) => disk.get(key));
  mocks.save.mockImplementation(async (key, value) => { disk.set(key, value); });
  mocks.remove.mockImplementation(async (key) => { disk.delete(key); });
  mocks.authorize.mockResolvedValue(token());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OIDC session lifecycle', () => {
  it('refreshes an immediate rejection after sign-in, coalesces old failures, and refreshes a newly rejected token', async () => {
    await signInWithOidc(identity, oidc);
    const fetch = vi.fn().mockResolvedValueOnce(response('renewed', 'rotated')).mockResolvedValueOnce(response('next'));
    vi.stubGlobal('fetch', fetch);
    expect(await refreshOidcSession(identity, oidc, 'initial')).toBe('renewed');
    expect(await refreshOidcSession(identity, oidc, 'initial')).toBe('renewed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await refreshOidcSession(identity, oidc, 'renewed')).toBe('next');
    expect(new URLSearchParams(fetch.mock.calls[1][1].body).get('refresh_token')).toBe('rotated');
    expect(disk.get(oidcSessionKeyFor(identity, oidc))?.refreshToken).toBe('rotated');
  });

  it('single-flights simultaneous 401 responses and keeps rotated credentials after restart', async () => {
    await signInWithOidc(identity, oidc);
    const pending = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(pending.promise); vi.stubGlobal('fetch', fetch);
    const requests = Array.from({ length: 8 }, () => refreshOidcSession(identity, oidc, 'initial'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    pending.resolve(response('renewed', 'rotated'));
    expect(await Promise.all(requests)).toEqual(Array(8).fill('renewed'));
    resetOidcSessionCache();
    expect(await getOidcAccessToken(identity, oidc)).toBe('renewed');
  });

  it.each([429, 500, 503])('preserves the session for HTTP %s, even with a misleading invalid_grant body', async (status) => {
    await signInWithOidc(identity, oidc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status })));
    await expect(refreshOidcSession(identity, oidc, 'initial')).rejects.toMatchObject({ code: 'provider-unavailable' });
    expect(await getOidcSessionStatus(identity, oidc)).toBe('signed-in');
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(['network', 'malformed', 'invalid-client'])('preserves sessions for %s failures', async (failure) => {
    await signInWithOidc(identity, oidc);
    vi.stubGlobal('fetch', failure === 'network' ? vi.fn().mockRejectedValue(new Error('offline'))
      : vi.fn().mockResolvedValue(failure === 'malformed' ? new Response('{}')
        : new Response(JSON.stringify({ error: 'invalid_client', error_description: 'must not echo' }), { status: 401 })));
    await expect(refreshOidcSession(identity, oidc, 'initial')).rejects.toBeInstanceOf(OidcAuthError);
    expect(await getOidcSessionStatus(identity, oidc)).toBe('signed-in');
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('preserves sessions on provider timeout', async () => {
    await signInWithOidc(identity, oidc); vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const assertion = expect(refreshOidcSession(identity, oidc, 'initial')).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('clears only a definitively revoked refresh token', async () => {
    await signInWithOidc(identity, oidc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'private-value' }), { status: 400 })));
    await expect(refreshOidcSession(identity, oidc, 'initial')).rejects.toMatchObject({ code: 'sign-in-required' });
    expect(await getOidcSessionStatus(identity, oidc)).toBe('signed-out');
    expect(disk.size).toBe(0);
  });

  it.each(['sign-out', 'replace'])('rejects a stale refresh after %s', async (action) => {
    await signInWithOidc(identity, oidc);
    const pending = deferred<Response>(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    const old = refreshOidcSession(identity, oidc, 'initial');
    const assertion = expect(old).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    if (action === 'sign-out') await signOutOidc(identity, oidc);
    else { mocks.authorize.mockResolvedValue(token('replacement')); await signInWithOidc(identity, oidc); }
    pending.resolve(response('stale', 'stale-refresh')); await assertion;
    expect(disk.get(oidcSessionKeyFor(identity, oidc))?.accessToken).toBe(action === 'replace' ? 'replacement' : undefined);
    expect(await getOidcSessionStatus(identity, oidc)).toBe(action === 'replace' ? 'signed-in' : 'signed-out');
  });

  it('orders sign-out deletion after an in-flight encrypted write', async () => {
    await signInWithOidc(identity, oidc);
    const write = deferred<void>();
    mocks.save.mockImplementationOnce(async (key, value) => { await write.promise; disk.set(key, value); });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const old = refreshOidcSession(identity, oidc, 'initial');
    const assertion = expect(old).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    const out = signOutOidc(identity, oidc); write.resolve();
    await Promise.all([assertion, out]); expect(disk.size).toBe(0);
  });

  it('cannot restore a browser sign-in or storage load after sign-out', async () => {
    const browser = deferred<OidcTokenSet>(); mocks.authorize.mockReturnValueOnce(browser.promise);
    const attempt = signInWithOidc(identity, oidc);
    const assertion = expect(attempt).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    await signOutOidc(identity, oidc); browser.resolve(token()); await assertion;
    resetOidcSessionCache();
    const read = deferred<OidcTokenSet>(); mocks.read.mockReturnValueOnce(read.promise);
    const loading = getOidcAccessToken(identity, oidc);
    const loaded = expect(loading).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    const out = signOutOidc(identity, oidc); read.resolve(token()); await Promise.all([out, loaded]);
    expect(await getOidcSessionStatus(identity, oidc)).toBe('signed-out');
  });

  it('caller cancellation does not cancel another caller’s shared rotation', async () => {
    await signInWithOidc(identity, oidc);
    const pending = deferred<Response>(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    const controller = new AbortController();
    const one = refreshOidcSession(identity, oidc, 'initial', controller.signal);
    const aborted = expect(one).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    const two = refreshOidcSession(identity, oidc, 'initial');
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    controller.abort(); await aborted; pending.resolve(response('renewed', 'rotated'));
    expect(await two).toBe('renewed'); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('keeps connection sessions isolated across sign-out and restart', async () => {
    await signInWithOidc(identity, oidc);
    const other = { ...identity, serverUrl: 'https://other.test' };
    mocks.authorize.mockResolvedValue(token('other')); await signInWithOidc(other, oidc);
    await signOutOidc(identity, oidc); resetOidcSessionCache();
    expect(await getOidcAccessToken(other, oidc)).toBe('other');
    expect(await getOidcSessionStatus(identity, oidc)).toBe('signed-out');
  });
});
