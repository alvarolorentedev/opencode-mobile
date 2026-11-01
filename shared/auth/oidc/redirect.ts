import { normalizeOidcIssuer } from '@/shared/contracts/connection-oidc';

export type OidcRedirect = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

// The authorization response can arrive as a query string or a fragment. Read
// both so a provider that defaults to `response_mode=fragment` still completes.
export function parseOidcRedirect(url: string): OidcRedirect {
  const result: OidcRedirect = {};
  const read = (params: URLSearchParams) => {
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const description = params.get('error_description');
    if (code && !result.code) result.code = code;
    if (state && !result.state) result.state = state;
    if (error && !result.error) result.error = error;
    if (description && !result.errorDescription) result.errorDescription = description;
  };

  try {
    const parsed = new URL(url);
    read(parsed.searchParams);
    if (parsed.hash) read(new URLSearchParams(parsed.hash.replace(/^#/, '')));
  } catch {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex >= 0) read(new URLSearchParams(url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)));
    if (hashIndex >= 0) read(new URLSearchParams(url.slice(hashIndex + 1)));
  }

  return result;
}

// The discovery document's `issuer` must match the configured issuer exactly
// after normalizing the trailing slash; otherwise a redirect or mixed-up
// provider could send codes to the wrong token endpoint.
export function issuerMatches(expected: string, actual: unknown) {
  return typeof actual === 'string' && normalizeOidcIssuer(actual) === normalizeOidcIssuer(expected);
}

// Authorization Code request with an S256 PKCE challenge. No client secret and
// no response_mode override: the app reads the code from either the query or the
// fragment.
export function buildOidcAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
