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

export function parseOidcTokenResponse(value: unknown, now = Date.now()): OidcTokenResponse | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : '';
  if (!accessToken) return undefined;
  const expiresIn = numberValue(record.expires_in);
  return {
    accessToken,
    ...(typeof record.refresh_token === 'string' && record.refresh_token.trim() ? { refreshToken: record.refresh_token.trim() } : {}),
    expiresAt: now + (expiresIn === undefined ? UNKNOWN_LIFETIME_MS : Math.max(0, expiresIn) * 1000),
    tokenType: typeof record.token_type === 'string' && record.token_type.trim() ? record.token_type.trim() : 'Bearer',
    ...(typeof record.scope === 'string' && record.scope.trim() ? { scope: record.scope.trim() } : {}),
  };
}

async function readErrorDetail(response: Response) {
  const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const error = typeof body?.error === 'string' ? body.error : '';
  const description = typeof body?.error_description === 'string' ? body.error_description : '';
  return [error, description].filter(Boolean).join(': ');
}

async function postTokenRequest(tokenEndpoint: string, form: Record<string, string>, signal?: AbortSignal): Promise<OidcTokenResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new OidcAuthError('sign-in-failed', `The OpenID Connect token request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    const tokens = parseOidcTokenResponse(await response.json().catch(() => undefined));
    if (!tokens) throw new OidcAuthError('sign-in-failed', 'The OpenID Connect token response did not contain an access token.');
    return tokens;
  } catch (error) {
    if (error instanceof OidcAuthError) throw error;
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
