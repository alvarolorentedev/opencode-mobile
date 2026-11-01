import { Platform } from 'react-native';

import { OIDC_REDIRECT_PATH, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import { OidcAuthError } from '@/shared/auth/oidc/errors';
import { discoverOidc } from '@/shared/auth/oidc/discovery';
import { createOidcState, createPkcePair } from '@/shared/auth/oidc/pkce';
import { parseOidcRedirect, buildOidcAuthorizationUrl } from '@/shared/auth/oidc/redirect';
import { exchangeOidcAuthorizationCode, type OidcTokenResponse } from '@/shared/auth/oidc/token-endpoint';
import { openAuthSessionAsync } from '@/shared/platform/browser';
import { createURL } from '@/shared/platform/linking';

// The app resolves this exact URI after the provider redirects. Native builds
// register the `opencodemobile` scheme; Expo development builds resolve the
// `exp://…/--/oidc-callback` form. Users copy the value into the provider's
// allowed redirect list, which is why the connection form shows it.
export function defaultOidcRedirectUri() {
  return createURL(OIDC_REDIRECT_PATH);
}

export function oidcRedirectUri(oidc: Pick<ConnectionOidc, 'redirectUri'>) {
  return oidc.redirectUri?.trim() || defaultOidcRedirectUri();
}

// Opens the system browser (never the in-app WebView, which the app cannot
// trust with credentials) and exchanges the returned code for tokens.
export async function runOidcAuthorization(oidc: ConnectionOidc, options?: { signal?: AbortSignal }): Promise<OidcTokenResponse> {
  if (Platform.OS === 'web') {
    throw new OidcAuthError('unsupported', 'OpenID Connect sign-in is not available in the web build.');
  }
  const discovery = await discoverOidc(oidc.issuer, options);
  const redirectUri = oidcRedirectUri(oidc);
  const [{ verifier, challenge }, state] = await Promise.all([createPkcePair(), createOidcState()]);
  const authorizationUrl = buildOidcAuthorizationUrl({
    authorizationEndpoint: discovery.authorizationEndpoint,
    clientId: oidc.clientId,
    redirectUri,
    scopes: oidc.scopes,
    state,
    codeChallenge: challenge,
  });

  const result = await openAuthSessionAsync(authorizationUrl, redirectUri);
  if (result.type !== 'success') {
    throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect sign-in was cancelled.');
  }
  const redirect = parseOidcRedirect(result.url);
  if (redirect.error) {
    throw new OidcAuthError('sign-in-failed', redirect.errorDescription || `The OpenID Connect provider returned ${redirect.error}.`);
  }
  if (!redirect.code) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect provider did not return an authorization code.');
  if (redirect.state !== state) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect response did not match this sign-in attempt.');

  return exchangeOidcAuthorizationCode({
    tokenEndpoint: discovery.tokenEndpoint,
    clientId: oidc.clientId,
    code: redirect.code,
    codeVerifier: verifier,
    redirectUri,
    signal: options?.signal,
  });
}
