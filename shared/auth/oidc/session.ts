import { normalizeServerUrl } from '@/shared/contracts/server-url';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { isSecureOidcUrl, normalizeOidcIssuer, oidcSessionKey, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import { deleteOidcTokens, readOidcTokens, saveOidcTokens, type OidcTokenSet } from '@/shared/storage/connection-oidc';
import { discoverOidc } from '@/shared/auth/oidc/discovery';
import { OIDC_SIGN_IN_REQUIRED_MESSAGE, OidcAuthError } from '@/shared/auth/oidc/errors';
import { runOidcAuthorization } from '@/shared/auth/oidc/flow';
import { refreshOidcAccessToken } from '@/shared/auth/oidc/token-endpoint';

export type OidcSessionIdentity = { serverUrl: string; username: string };
export type OidcSessionStatus = 'signed-in' | 'expired' | 'signed-out';
const EXPIRY_SKEW_MS = 60_000;
const cache = new Map<string, { tokens?: OidcTokenSet }>();
const inflight = new Map<string, Promise<OidcTokenSet>>();
const generations = new Map<string, number>();
const storage = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let nextGeneration = 0;

export function subscribeOidcSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch { /* a subscriber must not break token delivery */ }
  }
}

export function oidcSessionKeyFor(identity: OidcSessionIdentity, oidc: Pick<ConnectionOidc, 'issuer' | 'clientId'>) {
  return oidcSessionKey(getConnectionScope(identity), oidc);
}

function generation(key: string) {
  if (!generations.has(key)) generations.set(key, ++nextGeneration);
  return generations.get(key)!;
}

function invalidate(key: string) {
  generations.set(key, ++nextGeneration);
  inflight.delete(key);
  return nextGeneration;
}

function assertCurrent(key: string, expected: number) {
  if (generations.get(key) !== expected) {
    throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect session changed. Retry the operation.');
  }
}

// Serialize reads/writes/deletes so a slow encrypted write cannot outlive a
// sign-out deletion or overwrite a replacement session on disk.
function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (storage.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  storage.set(key, result);
  void result.finally(() => { if (storage.get(key) === result) storage.delete(key); }).catch(() => undefined);
  return result;
}

function usable(tokens: OidcTokenSet | undefined) {
  return Boolean(tokens && tokens.expiresAt - Date.now() > EXPIRY_SKEW_MS);
}

async function load(key: string): Promise<OidcTokenSet | undefined> {
  const cached = cache.get(key);
  if (cached) return cached.tokens;
  const expected = generation(key);
  return serialized(key, async () => {
    assertCurrent(key, expected);
    if (cache.has(key)) return cache.get(key)?.tokens;
    const tokens = await readOidcTokens(key);
    assertCurrent(key, expected);
    cache.set(key, { tokens });
    return tokens;
  });
}

function store(key: string, tokens: OidcTokenSet, expected: number) {
  return serialized(key, async () => {
    assertCurrent(key, expected);
    await saveOidcTokens(key, tokens);
    assertCurrent(key, expected);
    cache.set(key, { tokens });
    notify();
    return tokens;
  });
}

async function clear(key: string) {
  invalidate(key);
  cache.set(key, {});
  notify();
  await serialized(key, () => deleteOidcTokens(key));
}

function toTokenSet(oidc: ConnectionOidc, tokens: { accessToken: string; refreshToken?: string; expiresAt: number; tokenType: string; scope?: string }): OidcTokenSet {
  return { ...tokens, issuer: normalizeOidcIssuer(oidc.issuer), clientId: oidc.clientId.trim() };
}

async function refresh(key: string, oidc: ConnectionOidc, current: OidcTokenSet, expected: number): Promise<OidcTokenSet> {
  // Shared refreshes own their bounded provider deadline; one caller's abort
  // must not cancel rotation for every other request using this session.
  const discovery = await discoverOidc(oidc.issuer);
  assertCurrent(key, expected);
  try {
    const refreshed = await refreshOidcAccessToken({
      tokenEndpoint: discovery.tokenEndpoint, clientId: oidc.clientId,
      refreshToken: current.refreshToken!, scope: oidc.scopes,
    });
    return await store(key, toTokenSet(oidc, { ...refreshed, refreshToken: refreshed.refreshToken ?? current.refreshToken }), expected);
  } catch (error) {
    assertCurrent(key, expected);
    if (error instanceof OidcAuthError && error.code === 'refresh-token-invalid') {
      await clear(key);
      throw new OidcAuthError('sign-in-required', OIDC_SIGN_IN_REQUIRED_MESSAGE);
    }
    throw error;
  }
}

function refreshOnce(key: string, oidc: ConnectionOidc, current: OidcTokenSet, expected: number) {
  const pending = inflight.get(key);
  if (pending) return pending;
  const attempt = refresh(key, oidc, current, expected).finally(() => {
    if (inflight.get(key) === attempt) inflight.delete(key);
  });
  inflight.set(key, attempt);
  return attempt;
}

async function forCaller<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new OidcAuthError('sign-in-cancelled', 'OpenID Connect request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function getOidcAccessToken(identity: OidcSessionIdentity, oidc: ConnectionOidc, options?: { forceRefresh?: boolean; rejectedToken?: string; signal?: AbortSignal }): Promise<string> {
  const key = oidcSessionKeyFor(identity, oidc);
  const expected = generation(key);
  const current = await forCaller(load(key), options?.signal);
  assertCurrent(key, expected);
  if (current && usable(current) && (!options?.forceRefresh
    || (options.rejectedToken !== undefined && options.rejectedToken !== current.accessToken))) return current.accessToken;
  if (!current?.refreshToken) {
    if (current) await clear(key);
    throw new OidcAuthError('sign-in-required', OIDC_SIGN_IN_REQUIRED_MESSAGE);
  }
  return (await forCaller(refreshOnce(key, oidc, current, expected), options?.signal)).accessToken;
}

export function refreshOidcSession(identity: OidcSessionIdentity, oidc: ConnectionOidc, rejectedToken?: string, signal?: AbortSignal) {
  return getOidcAccessToken(identity, oidc, { forceRefresh: true, rejectedToken, signal });
}

export async function signInWithOidc(identity: OidcSessionIdentity, oidc: ConnectionOidc, options?: { signal?: AbortSignal }): Promise<OidcTokenSet> {
  if (!isSecureOidcUrl(normalizeServerUrl(identity.serverUrl).displayUrl)) throw new OidcAuthError('sign-in-failed', 'OpenID Connect requires a secure server endpoint.');
  const key = oidcSessionKeyFor(identity, oidc);
  const expected = invalidate(key);
  const tokens = await runOidcAuthorization(oidc, options);
  assertCurrent(key, expected);
  if (options?.signal?.aborted) throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect request cancelled.');
  return store(key, toTokenSet(oidc, tokens), invalidate(key));
}

export async function signOutOidc(identity: OidcSessionIdentity, oidc: Pick<ConnectionOidc, 'issuer' | 'clientId'>) {
  await clear(oidcSessionKeyFor(identity, oidc));
}

export async function getOidcSessionStatus(identity: OidcSessionIdentity, oidc: ConnectionOidc): Promise<OidcSessionStatus> {
  const tokens = await load(oidcSessionKeyFor(identity, oidc));
  if (!tokens) return 'signed-out';
  return usable(tokens) || tokens.refreshToken ? 'signed-in' : 'expired';
}

export function resetOidcSessionCache() {
  cache.clear(); inflight.clear(); generations.clear(); storage.clear(); listeners.clear();
}
