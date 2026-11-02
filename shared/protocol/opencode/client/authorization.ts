import { base64 } from '@scure/base';

import { isSecureOidcUrl, oidcTokenHeader, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import { normalizeServerUrl } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';

export function createAuthHeader(settings: OpencodeConnectionSettings) {
  const password = settings.password;
  if (!password) {
    return undefined;
  }

  const username = settings.username.trim() || 'opencode';
  return `Basic ${base64.encode(new TextEncoder().encode(`${username}:${password}`))}`;
}

export function getRequestHeaders(settings: OpencodeConnectionSettings) {
  const authHeader = createAuthHeader(settings);
  // Custom gateway headers apply to every request for this connection. Basic
  // auth is generated last: `authorization` is rejected by header validation, so
  // this only guarantees the app-owned value always wins.
  const headers = {
    ...(settings.headers ?? {}),
    ...(authHeader ? { Authorization: authHeader } : {}),
  };
  return Object.keys(headers).length ? headers : undefined;
}

function headerName(name: string) {
  return name.toLowerCase();
}

// Adds the OpenID Connect access token without taking over basic auth. The raw
// token goes in the configured header (oauth2-proxy and similar gateways read
// it there). Authorization keeps the existing Basic value when a password is
// configured; only a passwordless connection falls back to `Bearer` there.
export function withOidcAuthorization(headers: HeadersInit | undefined, token: string | undefined, oidc: ConnectionOidc): HeadersInit | undefined {
  if (!token) return headers;
  const merged = new Headers(headers);
  merged.set(oidcTokenHeader(oidc), token);
  if (!merged.has('Authorization')) merged.set('Authorization', `Bearer ${token}`);
  return merged;
}

// Object-shaped variant for transports that take a plain header record (the
// terminal WebSocket upgrade) instead of a Headers instance.
export function withOidcAuthorizationObject(headers: Record<string, string> | undefined, token: string | undefined, oidc: ConnectionOidc): Record<string, string> | undefined {
  if (!token) return headers;
  const next: Record<string, string> = {};
  const tokenHeader = headerName(oidcTokenHeader(oidc));
  let hasAuthorization = false;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = headerName(name);
    if (key === tokenHeader) continue;
    if (key === 'authorization') hasAuthorization = true;
    next[name] = value;
  }
  next[oidcTokenHeader(oidc)] = token;
  if (!hasAuthorization) next.Authorization = `Bearer ${token}`;
  return next;
}

// Resolves the access token just before a request. A missing or expired session
// throws a sign-in error; an expired access token with a valid refresh token is
// renewed here, before the request leaves the device.
export async function resolveAuthorizedHeaders(settings: OpencodeConnectionSettings | undefined, headers: HeadersInit | undefined): Promise<HeadersInit | undefined> {
  if (!settings?.oidc) return headers;
  // Loaded on demand: the OIDC stack pulls Keychain/Keystore-backed storage,
  // and connections that do not use it must not pay for that module graph (or
  // break non-native test runtimes).
  const { getOidcAccessToken } = await import('@/shared/auth/oidc/session');
  const token = await getOidcAccessToken(settings, settings.oidc);
  // Basic auth and gateway headers are merged in even when the caller supplies
  // its own headers (the SDK sends Accept/content-type itself), so enabling
  // OIDC never drops the password the way a straight bearer replacement did.
  const base = new Headers(getRequestHeaders(settings));
  new Headers(headers ?? {}).forEach((value, name) => base.set(name, value));
  const basic = createAuthHeader(settings);
  if (basic) base.set('Authorization', basic);
  return withOidcAuthorization(base, token, settings.oidc);
}

// Called after a 401/403. A successful refresh lets the transport replay the
// request once; a dead refresh token throws the sign-in-required error that the
// connection surface turns into a "Sign in again" action.
export async function refreshOidcAuthorization(settings: OpencodeConnectionSettings | undefined, rejectedToken: string | undefined) {
  if (!settings?.oidc) return false;
  const { refreshOidcSession } = await import('@/shared/auth/oidc/session');
  await refreshOidcSession(settings, settings.oidc, rejectedToken);
  return true;
}

// Validate before resolving any credentials. The API mount is the narrowest
// shared destination boundary across SDKs, probes, SSE and terminal tickets.
export function assertOidcRequestTarget(settings: OpencodeConnectionSettings, input: string) {
  const base = normalizeServerUrl(settings.serverUrl);
  const target = new URL(input);
  if (!base.valid || !isSecureOidcUrl(base.displayUrl) || !isSecureOidcUrl(input)
    || target.origin !== base.origin
    || (base.pathPrefix && target.pathname !== base.pathPrefix && !target.pathname.startsWith(`${base.pathPrefix}/`))) {
    throw new Error('OpenID Connect credentials require the configured secure server endpoint.');
  }
}
