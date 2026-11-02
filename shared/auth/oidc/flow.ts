import { Platform } from 'react-native';

import { isValidOidcRedirectUri, OIDC_DEFAULT_REDIRECT_URI, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import { OidcAuthError } from '@/shared/auth/oidc/errors';
import { discoverOidc } from '@/shared/auth/oidc/discovery';
import { parseOidcRedirect } from '@/shared/auth/oidc/redirect';
import { exchangeOidcAuthorizationCode, type OidcTokenResponse } from '@/shared/auth/oidc/token-endpoint';
import { AuthRequest, CodeChallengeMethod, ResponseType } from '@/shared/platform/auth-session';

export function defaultOidcRedirectUri() {
  return OIDC_DEFAULT_REDIRECT_URI;
}

export function oidcRedirectUri(oidc: Pick<ConnectionOidc, 'redirectUri'>) {
  return oidc.redirectUri?.trim() || defaultOidcRedirectUri();
}

export async function runOidcAuthorization(oidc: ConnectionOidc, options?: { signal?: AbortSignal }): Promise<OidcTokenResponse> {
  if (Platform.OS === 'web') {
    throw new OidcAuthError('unsupported', 'OpenID Connect sign-in is not available in the web build.');
  }
  const redirectUri = oidcRedirectUri(oidc);
  if (!isValidOidcRedirectUri(redirectUri)) throw new OidcAuthError('sign-in-failed', 'OpenID Connect requires a registered app callback URI.');
  const discovery = await discoverOidc(oidc.issuer, options);
  if (options?.signal?.aborted) throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect request cancelled.');
  const request = new AuthRequest({
    clientId: oidc.clientId, redirectUri, scopes: oidc.scopes.split(/\s+/),
    responseType: ResponseType.Code, usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256,
  });
  // Expo owns PKCE, state validation and system-browser session coordination.
  // AuthSession appends "?"; preserve provider query parameters without
  // allowing them to replace Expo-generated OAuth/PKCE values.
  const endpoint = new URL(discovery.authorizationEndpoint);
  const providerParams = new URLSearchParams(endpoint.search);
  endpoint.search = '';
  const authorizationUrl = new URL(await request.makeAuthUrlAsync({ authorizationEndpoint: endpoint.toString() }));
  providerParams.forEach((value, name) => { if (!authorizationUrl.searchParams.has(name)) authorizationUrl.searchParams.append(name, value); });
  const result = await request.promptAsync(discovery, { url: authorizationUrl.toString() });
  if (result.type !== 'success' && result.type !== 'error') {
    throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect sign-in was cancelled.');
  }
  const redirect = parseOidcRedirect(result.url, redirectUri);
  if (redirect.state !== request.state) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect response did not match this sign-in attempt.');
  if (result.type === 'error' || redirect.error) {
    // Never display provider text: it can contain secrets or untrusted URLs.
    throw new OidcAuthError('sign-in-failed', 'The OpenID Connect provider rejected sign-in. Check the provider configuration.');
  }
  if (!redirect.code || !request.codeVerifier) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect provider did not return an authorization code.');
  if (options?.signal?.aborted) throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect request cancelled.');
  return exchangeOidcAuthorizationCode({
    tokenEndpoint: discovery.tokenEndpoint, clientId: oidc.clientId,
    code: redirect.code, codeVerifier: request.codeVerifier, redirectUri, signal: options?.signal,
  });
}
