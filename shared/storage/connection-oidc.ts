import { createEncryptedStore } from '@/shared/storage/encrypted-store';

// Refresh tokens outlive the browser session, so they are treated like a
// password: encrypted at rest with AES-256-GCM and a key held in
// Keychain/Keystore. SecureStore itself is a poor fit for token sets (JWT
// access tokens plus a refresh token easily exceed its 2 KB value guidance on
// Android), which is why the ciphertext lives in AsyncStorage instead.
export type OidcTokenSet = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. A token without a known lifetime uses 0. */
  expiresAt: number;
  tokenType: string;
  scope?: string;
  /** Remembers which provider issued the token so a config change cannot reuse it. */
  issuer: string;
  clientId: string;
};

const OIDC_KEY_STORAGE_KEY = 'opencode-mobile.oidc-key';
const oidc = createEncryptedStore(OIDC_KEY_STORAGE_KEY);

const MAX_TOKEN_LENGTH = 32_768;

function tokenStorageKey(sessionKey: string) {
  // SecureStore keys may only contain alphanumerics, ".", "-" and "_"; the
  // session key already satisfies that and AsyncStorage has no such limit.
  return `${sessionKey}.tokens`;
}

function tokenAad(sessionKey: string) {
  return `opencode-mobile:oidc:${sessionKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && /^[\x20-\x7E]+$/.test(value);
}

export function parseOidcTokenSet(value: unknown): OidcTokenSet | undefined {
  if (!isRecord(value)) return undefined;
  if (!isToken(value.accessToken) || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return undefined;
  if (value.refreshToken !== undefined && !isToken(value.refreshToken)) return undefined;
  if (typeof value.issuer !== 'string' || typeof value.clientId !== 'string') return undefined;
  return {
    accessToken: value.accessToken,
    ...(value.refreshToken !== undefined ? { refreshToken: value.refreshToken } : {}),
    expiresAt: value.expiresAt,
    tokenType: typeof value.tokenType === 'string' && value.tokenType ? value.tokenType : 'Bearer',
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
    issuer: value.issuer,
    clientId: value.clientId,
  };
}

export async function readOidcTokens(sessionKey: string): Promise<OidcTokenSet | undefined> {
  const storageKey = tokenStorageKey(sessionKey);
  const ciphertext = await oidc.readCiphertext(storageKey);
  if (!ciphertext) return undefined;
  const encryptionKey = await oidc.key();
  try {
    const tokens = parseOidcTokenSet(JSON.parse(await oidc.decrypt(encryptionKey, tokenAad(sessionKey), ciphertext)));
    if (!tokens) throw new Error('invalid token payload');
    return tokens;
  } catch {
    // A failed tag or malformed payload must fail closed.
    await oidc.writeCiphertext(storageKey, '').catch(() => undefined);
    return undefined;
  }
}

export async function saveOidcTokens(sessionKey: string, tokens: OidcTokenSet) {
  const encryptionKey = await oidc.key();
  const ciphertext = await oidc.encrypt(encryptionKey, tokenAad(sessionKey), JSON.stringify(tokens));
  await oidc.writeCiphertext(tokenStorageKey(sessionKey), ciphertext);
}

export async function deleteOidcTokens(sessionKey: string) {
  await oidc.writeCiphertext(tokenStorageKey(sessionKey), '');
}
