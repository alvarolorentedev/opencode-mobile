import { isValidOidcRedirectUri, normalizeOidcIssuer } from '@/shared/contracts/connection-oidc';
import { OidcAuthError } from '@/shared/auth/oidc/errors';

export type OidcRedirect = { code?: string; state?: string; error?: string };

export function parseOidcRedirect(url: string, redirectUri: string): OidcRedirect {
  const fail = () => new OidcAuthError('sign-in-failed', 'The OpenID Connect callback did not match the configured redirect URI.');
  if (!isValidOidcRedirectUri(redirectUri) || /[\s\\]/.test(url)) throw fail();
  const target = url.split(/[?#]/, 1)[0];
  if (target !== redirectUri) throw fail();
  try {
    // RN's URL parser does not expose custom-scheme hostnames consistently.
    new URL(url);
    const queryIndex = url.indexOf('?');
    const hashIndex = url.indexOf('#');
    const query = queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex)
      ? new URLSearchParams(url.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex)) : new URLSearchParams();
    const fragment = new URLSearchParams(hashIndex < 0 ? '' : url.slice(hashIndex + 1));
    const result: OidcRedirect = {};
    for (const key of ['code', 'state', 'error'] as const) {
      const values = [...query.getAll(key), ...fragment.getAll(key)];
      if (values.length > 1) throw fail();
      if (values[0]) result[key] = values[0];
    }
    if (result.code && result.error) throw fail();
    return result;
  } catch {
    throw fail();
  }
}

export function issuerMatches(expected: string, actual: unknown) {
  const issuer = normalizeOidcIssuer(expected);
  return Boolean(issuer && typeof actual === 'string' && normalizeOidcIssuer(actual) === issuer);
}
