import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';

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

const MAX_TOKEN_LENGTH = 32_768;

function tokenStorageKey(sessionKey: string) {
  // SecureStore keys may only contain alphanumerics, ".", "-" and "_"; the
  // session key already satisfies that and AsyncStorage has no such limit.
  return `${sessionKey}.tokens`;
}

function tokenAad(sessionKey: string) {
  return new TextEncoder().encode(`opencode-mobile:oidc:${sessionKey}`);
}

async function readKeyMaterial() {
  if (Platform.OS === 'web') return getConnectTestSecret(OIDC_KEY_STORAGE_KEY);
  return (await SecureStore.getItemAsync(OIDC_KEY_STORAGE_KEY)) ?? '';
}

async function writeKeyMaterial(value: string) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(OIDC_KEY_STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(OIDC_KEY_STORAGE_KEY, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

let cachedKey: Promise<AESEncryptionKey> | undefined;

async function createTokenKey() {
  let encoded = await readKeyMaterial();
  if (!encoded) {
    const generated = await AESEncryptionKey.generate();
    encoded = await generated.encoded('base64');
    await writeKeyMaterial(encoded);
  }
  return AESEncryptionKey.import(encoded, 'base64');
}

function tokenKey() {
  if (!cachedKey) cachedKey = createTokenKey().catch((error) => { cachedKey = undefined; throw error; });
  return cachedKey;
}

async function readCiphertext(key: string) {
  if (Platform.OS === 'web') return getConnectTestSecret(key);
  return (await AsyncStorage.getItem(key)) ?? '';
}

async function writeCiphertext(key: string, value: string) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(key, value);
    return;
  }
  if (value) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await AsyncStorage.removeItem(key);
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
  const ciphertext = await readCiphertext(storageKey);
  if (!ciphertext) return undefined;
  const key = await tokenKey();
  try {
    const sealed = AESSealedData.fromCombined(ciphertext, { ivLength: 12, tagLength: 16 });
    const bytes = await aesDecryptAsync(sealed, key, { output: 'bytes', additionalData: tokenAad(sessionKey) });
    const tokens = parseOidcTokenSet(JSON.parse(new TextDecoder().decode(bytes)));
    if (!tokens) throw new Error('invalid token payload');
    return tokens;
  } catch {
    // A missing key, failed tag, or malformed payload must fail closed.
    await writeCiphertext(storageKey, '').catch(() => undefined);
    return undefined;
  }
}

export async function saveOidcTokens(sessionKey: string, tokens: OidcTokenSet) {
  const key = await tokenKey();
  const sealed = await aesEncryptAsync(
    new TextEncoder().encode(JSON.stringify(tokens)),
    key,
    { additionalData: tokenAad(sessionKey) },
  );
  const ciphertext = await sealed.combined('base64');
  await writeCiphertext(tokenStorageKey(sessionKey), ciphertext);
}

export async function deleteOidcTokens(sessionKey: string) {
  await writeCiphertext(tokenStorageKey(sessionKey), '');
}
