import { fetch as expoFetch } from 'expo/fetch';

import { isSecureOidcUrl } from '@/shared/contracts/connection-oidc';
import { OidcAuthError } from '@/shared/auth/oidc/errors';

export type OidcTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
};

const TOKEN_TIMEOUT_MS = 15_000;

// Providers commonly omit `expires_in` for opaque tokens. Treat an unknown
// lifetime as short so the app revalidates with the refresh token rather than
// trusting a possibly long-dead token forever.
const UNKNOWN_LIFETIME_MS = 300_000;

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function tokenValue(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return token && token.length <= 32_768 && /^[\x20-\x7E]+$/.test(token) ? token : undefined;
}

export function parseOidcTokenResponse(value: unknown, now = Date.now()): OidcTokenResponse | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const accessToken = tokenValue(record.access_token);
  if (!accessToken) return undefined;
  const refreshToken = tokenValue(record.refresh_token);
  if (record.refresh_token != null && !refreshToken) return undefined;
  const expiresIn = numberValue(record.expires_in);
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: now + (expiresIn === undefined ? UNKNOWN_LIFETIME_MS : Math.max(0, expiresIn) * 1000),
    tokenType: typeof record.token_type === 'string' && record.token_type.trim() ? record.token_type.trim() : 'Bearer',
    ...(typeof record.scope === 'string' && record.scope.trim() ? { scope: record.scope.trim() } : {}),
  };
}

async function postTokenRequest(tokenEndpoint: string, form: Record<string, string>, signal?: AbortSignal): Promise<OidcTokenResponse> {
  if (!isSecureOidcUrl(tokenEndpoint)) throw new OidcAuthError('sign-in-failed', 'OpenID Connect requires a secure token endpoint.');
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TOKEN_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await expoFetch(tokenEndpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      if (response.status === 429 || response.status >= 500) {
        throw new OidcAuthError('provider-unavailable', `The OpenID Connect provider is temporarily unavailable (${response.status}). Try again later.`);
      }
      if ((response.status === 400 || response.status === 401) && body?.error === 'invalid_grant') {
        throw new OidcAuthError('refresh-token-invalid', 'The OpenID Connect authorization grant is invalid or revoked.');
      }
      // Provider descriptions are untrusted and may echo credentials.
      throw new OidcAuthError('sign-in-failed', `The OpenID Connect token request failed (${response.status}). Check the provider configuration.`);
    }
    const tokens = parseOidcTokenResponse(await response.json().catch(() => undefined));
    if (!tokens) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect token response did not contain an access token.');
    return tokens;
  } catch (error) {
    if (error instanceof OidcAuthError) throw error;
    if (signal?.aborted) throw new OidcAuthError('sign-in-cancelled', 'OpenID Connect request cancelled.');
    if (timedOut) throw new OidcAuthError('timeout', 'The OpenID Connect token endpoint timed out. Try again later.');
    throw new OidcAuthError('network', 'Could not reach the OpenID Connect token endpoint.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function exchangeOidcAuthorizationCode(input: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  signal?: AbortSignal;
}) {
  return postTokenRequest(input.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  }, input.signal);
}

export function refreshOidcAccessToken(input: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  signal?: AbortSignal;
}) {
  return postTokenRequest(input.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    ...(input.scope ? { scope: input.scope } : {}),
  }, input.signal);
}
