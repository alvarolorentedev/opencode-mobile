import { isSecureOidcUrl, normalizeOidcIssuer, oidcDiscoveryUrl } from '@/shared/contracts/connection-oidc';
import { fetch as expoFetch } from 'expo/fetch';

import { OidcAuthError } from '@/shared/auth/oidc/errors';
import { issuerMatches } from '@/shared/auth/oidc/redirect';

export type OidcDiscovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
};

const DISCOVERY_TIMEOUT_MS = 10_000;

const cache = new Map<string, OidcDiscovery>();

function endpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return isSecureOidcUrl(value.trim()) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseOidcDiscovery(value: unknown, expectedIssuer: string): OidcDiscovery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!issuerMatches(expectedIssuer, record.issuer)) return undefined;
  const authorizationEndpoint = endpoint(record.authorization_endpoint);
  const tokenEndpoint = endpoint(record.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) return undefined;
  const endSessionEndpoint = endpoint(record.end_session_endpoint);
  return {
    issuer: normalizeOidcIssuer(expectedIssuer),
    authorizationEndpoint,
    tokenEndpoint,
    ...(endSessionEndpoint ? { endSessionEndpoint } : {}),
  };
}

export async function discoverOidc(issuer: string, options?: { signal?: AbortSignal }): Promise<OidcDiscovery> {
  const normalized = normalizeOidcIssuer(issuer);
  if (!normalized) throw new OidcAuthError('discovery', 'Enter a valid OpenID Connect issuer URL.');
  const cached = cache.get(normalized);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const abort = () => controller.abort();
  options?.signal?.addEventListener('abort', abort, { once: true });
  if (options?.signal?.aborted) abort();
  try {
    const response = await expoFetch(oidcDiscoveryUrl(normalized), {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new OidcAuthError('discovery', `The OpenID Connect provider returned ${response.status} for its discovery document.`);
    const discovery = parseOidcDiscovery(await response.json().catch(() => undefined), normalized);
    if (!discovery) throw new OidcAuthError('discovery', 'The OpenID Connect discovery document is incomplete or names a different issuer.');
    cache.set(normalized, discovery);
    return discovery;
  } catch (error) {
    if (error instanceof OidcAuthError) throw error;
    throw new OidcAuthError('network', 'Could not reach the OpenID Connect provider. Check the issuer URL and the connection.');
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abort);
  }
}

// Tests and provider changes rely on a cold cache.
export function clearOidcDiscoveryCache() {
  cache.clear();
}
