import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { normalizeOidcIssuer, oidcSessionKey, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import { deleteOidcTokens, readOidcTokens, saveOidcTokens, type OidcTokenSet } from '@/shared/storage/connection-oidc';
import { discoverOidc } from '@/shared/auth/oidc/discovery';
import { OIDC_SIGN_IN_REQUIRED_MESSAGE, OidcAuthError } from '@/shared/auth/oidc/errors';
import { runOidcAuthorization } from '@/shared/auth/oidc/flow';
import { refreshOidcAccessToken } from '@/shared/auth/oidc/token-endpoint';

// One process-wide session table, keyed by connection scope + provider. Values
// are cached so a burst of parallel reads does not hit encrypted storage, and
// refreshes are single-flight so a 401 storm cannot mint a refresh-token herd.
export type OidcSessionIdentity = { serverUrl: string; username: string };

export type OidcSessionStatus = 'signed-in' | 'expired' | 'signed-out';

// Refresh slightly before expiry so a token cannot die mid-request on a slow
// cellular link.
const EXPIRY_SKEW_MS = 60_000;

// A forced refresh that follows another forced refresh within this window
// reuses its result; it is the same rejected request storm, not a new attempt.
const REFRESH_COALESCE_MS = 5_000;

type CacheEntry = { tokens?: OidcTokenSet };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OidcTokenSet>>();
const refreshedAt = new Map<string, number>();
const listeners = new Set<() => void>();

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

function usable(tokens: OidcTokenSet | undefined) {
  return Boolean(tokens && tokens.expiresAt - Date.now() > EXPIRY_SKEW_MS);
}

async function load(key: string): Promise<OidcTokenSet | undefined> {
  const cached = cache.get(key);
  if (cached) return cached.tokens;
  const tokens = await readOidcTokens(key).catch(() => undefined);
  cache.set(key, { tokens });
  return tokens;
}

async function store(key: string, tokens: OidcTokenSet) {
  await saveOidcTokens(key, tokens);
  cache.set(key, { tokens });
  refreshedAt.set(key, Date.now());
  notify();
  return tokens;
}

async function clear(key: string) {
  cache.set(key, {});
  refreshedAt.delete(key);
  await deleteOidcTokens(key).catch(() => undefined);
  notify();
}

function toTokenSet(oidc: ConnectionOidc, tokens: { accessToken: string; refreshToken?: string; expiresAt: number; tokenType: string; scope?: string }): OidcTokenSet {
  return {
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    issuer: normalizeOidcIssuer(oidc.issuer),
    clientId: oidc.clientId.trim(),
  };
}

async function refresh(key: string, oidc: ConnectionOidc, current: OidcTokenSet | undefined, signal?: AbortSignal): Promise<OidcTokenSet> {
  if (!current?.refreshToken) {
    await clear(key);
    throw new OidcAuthError('sign-in-required', OIDC_SIGN_IN_REQUIRED_MESSAGE);
  }
  const discovery = await discoverOidc(oidc.issuer, { signal });
  try {
    const refreshed = await refreshOidcAccessToken({
      tokenEndpoint: discovery.tokenEndpoint,
      clientId: oidc.clientId,
      refreshToken: current.refreshToken,
      scope: oidc.scopes,
      signal,
    });
    // Refresh-token rotation is optional; keep the previous token when the
    // provider does not send a new one.
    return await store(key, toTokenSet(oidc, { ...refreshed, refreshToken: refreshed.refreshToken ?? current.refreshToken }));
  } catch (error) {
    if (error instanceof OidcAuthError && error.code === 'sign-in-failed') {
      // invalid_grant and friends mean the refresh token is dead. Keep the
      // error recognizable while forcing the next attempt through sign-in.
      await clear(key);
      throw new OidcAuthError('sign-in-required', OIDC_SIGN_IN_REQUIRED_MESSAGE);
    }
    throw error;
  }
}

function refreshOnce(key: string, oidc: ConnectionOidc, current: OidcTokenSet | undefined, signal?: AbortSignal) {
  const pending = inflight.get(key);
  if (pending) return pending;
  const attempt = refresh(key, oidc, current, signal).finally(() => { inflight.delete(key); });
  inflight.set(key, attempt);
  return attempt;
}

export async function getOidcAccessToken(identity: OidcSessionIdentity, oidc: ConnectionOidc, options?: { forceRefresh?: boolean; signal?: AbortSignal }): Promise<string> {
  const key = oidcSessionKeyFor(identity, oidc);
  const current = await load(key);
  if (current && !options?.forceRefresh && usable(current)) return current.accessToken;

  if (options?.forceRefresh) {
    // The rejected token has just been refreshed by a parallel request.
    const last = refreshedAt.get(key) ?? 0;
    if (current && usable(current) && Date.now() - last < REFRESH_COALESCE_MS) return current.accessToken;
  }
  if (!current?.refreshToken) {
    // The rejected token cannot be renewed; drop it so the next attempt starts
    // from the sign-in state instead of replaying a token the server refuses.
    if (current) await clear(key);
    throw new OidcAuthError('sign-in-required', OIDC_SIGN_IN_REQUIRED_MESSAGE);
  }
  return (await refreshOnce(key, oidc, current, options?.signal)).accessToken;
}

// Called by the transport after a 401/403. Returns the replacement access token
// or throws the sign-in-required error the connection surface shows.
export function refreshOidcSession(identity: OidcSessionIdentity, oidc: ConnectionOidc, signal?: AbortSignal) {
  return getOidcAccessToken(identity, oidc, { forceRefresh: true, signal });
}

export async function signInWithOidc(identity: OidcSessionIdentity, oidc: ConnectionOidc, options?: { signal?: AbortSignal }): Promise<OidcTokenSet> {
  const tokens = await runOidcAuthorization(oidc, options);
  const key = oidcSessionKeyFor(identity, oidc);
  return store(key, toTokenSet(oidc, tokens));
}

export async function signOutOidc(identity: OidcSessionIdentity, oidc: Pick<ConnectionOidc, 'issuer' | 'clientId'>) {
  await clear(oidcSessionKeyFor(identity, oidc));
}

export async function getOidcSessionStatus(identity: OidcSessionIdentity, oidc: ConnectionOidc): Promise<OidcSessionStatus> {
  const tokens = await load(oidcSessionKeyFor(identity, oidc));
  if (!tokens) return 'signed-out';
  return usable(tokens) || tokens.refreshToken ? 'signed-in' : 'expired';
}

// Test seam: drop the in-memory table without touching encrypted storage.
export function resetOidcSessionCache() {
  cache.clear();
  inflight.clear();
  refreshedAt.clear();
  listeners.clear();
}
