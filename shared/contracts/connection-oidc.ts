import { base64urlnopad } from '@scure/base';

// Per-connection OpenID Connect authorization for gateways that expect an
// access token alongside (or instead of) basic auth. The issuer and client
// identifier are non-secret and travel with the saved connection profile; the
// tokens themselves live in an encrypted store keyed by the connection scope.
//
// Only public clients using Authorization Code + PKCE are supported. A secret
// stored on a phone is not a secret, and the app never sees the user's
// password: the sign-in happens in the system browser and returns a code.
export type ConnectionOidc = {
  /** Normalized issuer URL, for example https://login.example.com/realms/acme. */
  issuer: string;
  clientId: string;
  /** Space-separated scopes. Always contains `openid`. */
  scopes: string;
  /**
   * Request header that carries the raw access token. When a password is also
   * configured, Authorization keeps basic auth and the JWT only appears here.
   */
  tokenHeader: string;
  /** Optional override; defaults to the app's own redirect scheme. */
  redirectUri?: string;
};

export const OIDC_DEFAULT_SCOPES = 'openid profile email offline_access';

export const OIDC_REDIRECT_PATH = 'oidc-callback';
export const OIDC_DEFAULT_REDIRECT_URI = `opencodemobile://${OIDC_REDIRECT_PATH}`;

// oauth2-proxy's conventional upstream header. The token is sent raw (no
// "Bearer " prefix); Authorization carries the prefix when basic auth is absent.
export const OIDC_DEFAULT_TOKEN_HEADER = 'X-Auth-Request-Access-Token';

export const MAX_OIDC_TOKEN_HEADER_LENGTH = 128;

export const MAX_OIDC_ISSUER_LENGTH = 2048;

export const MAX_OIDC_CLIENT_ID_LENGTH = 512;

export const MAX_OIDC_SCOPES_LENGTH = 1024;

export const MAX_OIDC_REDIRECT_URI_LENGTH = 2048;

// RFC 6749 scope-token: printable ASCII except space, quote and backslash.
const SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export type OidcConfigError = 'issuer' | 'clientId' | 'scopes' | 'tokenHeader' | 'redirectUri';

// RFC 7230 token characters. The Authorization header cannot be the token
// carrier: the app owns it for basic/Bearer and a second value is impossible.
const TOKEN_HEADER_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const RESERVED_TOKEN_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'expect',
  'host',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function normalizeOidcTokenHeader(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed || OIDC_DEFAULT_TOKEN_HEADER;
}

export function isValidOidcTokenHeader(value: string | undefined) {
  const header = (value ?? '').trim();
  // Blank means "use the default", so the field can be cleared while editing.
  if (!header) return true;
  if (header.length > MAX_OIDC_TOKEN_HEADER_LENGTH || !TOKEN_HEADER_PATTERN.test(header)) return false;
  return !RESERVED_TOKEN_HEADERS.has(header.toLowerCase());
}

export function oidcTokenHeader(oidc: Pick<ConnectionOidc, 'tokenHeader'>) {
  return normalizeOidcTokenHeader(oidc.tokenHeader);
}

function normalizeScopes(value: string | undefined) {
  const seen = new Set<string>();
  const tokens = (value ?? '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (!SCOPE_TOKEN_PATTERN.test(token) || token.length > 256) return undefined;
    seen.add(token);
  }
  seen.add('openid');
  return [...seen].join(' ');
}

export function isSecureOidcUrl(value: string) {
  if (!/^https?:\/\/[^/?#]+/i.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch {
    return false;
  }
}

// Accepts bare hosts for convenience (`login.example.com/realms/acme`) because
// the connection URL field does the same, then stores the normalized absolute
// issuer without a trailing slash. Query strings and fragments cannot be part
// of an issuer identifier per OIDC Discovery.
export function normalizeOidcIssuer(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // An explicit non-HTTP scheme is a typo, not a hostname to prefix.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!isSecureOidcUrl(withProtocol) || parsed.search || parsed.hash) return '';
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function isValidOidcIssuer(value: string) {
  return Boolean(normalizeOidcIssuer(value));
}

export function isValidOidcRedirectUri(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_OIDC_REDIRECT_URI_LENGTH) return false;
  try {
    const parsed = new URL(trimmed);
    // Only the scheme registered in app.config.ts; HTTPS app links and Expo Go
    // callbacks are not registered authentication entrypoints in this app.
    return parsed.protocol === 'opencodemobile:'
      && /^opencodemobile:\/\/(?:oidc-callback\/?|\/oidc-callback)$/.test(trimmed)
      && !parsed.username && !parsed.password && !parsed.port;
  } catch {
    return false;
  }
}

export function oidcConfigError(draft: Pick<ConnectionOidc, 'issuer' | 'clientId' | 'scopes' | 'tokenHeader' | 'redirectUri'>): OidcConfigError | undefined {
  const issuer = normalizeOidcIssuer(draft.issuer);
  if (!issuer || issuer.length > MAX_OIDC_ISSUER_LENGTH) return 'issuer';
  const clientId = draft.clientId.trim();
  if (!clientId || clientId.length > MAX_OIDC_CLIENT_ID_LENGTH || /[\r\n\0]/.test(clientId)) return 'clientId';
  if (!normalizeScopes(draft.scopes) || (draft.scopes ?? '').length > MAX_OIDC_SCOPES_LENGTH) return 'scopes';
  if (!isValidOidcTokenHeader(draft.tokenHeader)) return 'tokenHeader';
  if (draft.redirectUri !== undefined && draft.redirectUri.trim() && !isValidOidcRedirectUri(draft.redirectUri)) return 'redirectUri';
  return undefined;
}

// Builds the canonical runtime value from editor input. Returns undefined when
// the input is not a usable configuration, so callers cannot persist a
// half-valid OIDC block.
export function toConnectionOidc(value: Pick<ConnectionOidc, 'issuer' | 'clientId' | 'scopes' | 'tokenHeader' | 'redirectUri'>): ConnectionOidc | undefined {
  if (oidcConfigError(value)) return undefined;
  const redirectUri = value.redirectUri?.trim();
  return {
    issuer: normalizeOidcIssuer(value.issuer),
    clientId: value.clientId.trim(),
    scopes: normalizeScopes(value.scopes)!,
    tokenHeader: normalizeOidcTokenHeader(value.tokenHeader),
    ...(redirectUri ? { redirectUri } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads a persisted/runtime value defensively. Unknown or malformed blocks are
// dropped rather than partially applied.
export function parseConnectionOidc(value: unknown): ConnectionOidc | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.issuer !== 'string' || typeof value.clientId !== 'string') return undefined;
  return toConnectionOidc({
    issuer: value.issuer,
    clientId: value.clientId,
    scopes: typeof value.scopes === 'string' ? value.scopes : OIDC_DEFAULT_SCOPES,
    tokenHeader: typeof value.tokenHeader === 'string' ? value.tokenHeader : OIDC_DEFAULT_TOKEN_HEADER,
    redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : undefined,
  });
}

export function oidcDiscoveryUrl(issuer: string) {
  return `${normalizeOidcIssuer(issuer)}/.well-known/openid-configuration`;
}

// Stable, URL-safe storage key for one server + user + provider. The server
// scope already excludes secrets, so the key is safe for AsyncStorage and never
// reveals a token.
export function oidcSessionKey(connectionScope: string, oidc: Pick<ConnectionOidc, 'issuer' | 'clientId'>) {
  const identity = `${connectionScope}\n${normalizeOidcIssuer(oidc.issuer)}\n${oidc.clientId.trim()}`;
  return `opencode-mobile.oidc.${base64urlnopad.encode(new TextEncoder().encode(identity))}`;
}

export function sameConnectionOidc(left: ConnectionOidc | undefined, right: ConnectionOidc | undefined) {
  if (!left || !right) return !left && !right;
  return normalizeOidcIssuer(left.issuer) === normalizeOidcIssuer(right.issuer)
    && left.clientId.trim() === right.clientId.trim()
    && left.scopes.trim() === right.scopes.trim()
    && oidcTokenHeader(left).toLowerCase() === oidcTokenHeader(right).toLowerCase()
    && (left.redirectUri ?? '') === (right.redirectUri ?? '');
}
