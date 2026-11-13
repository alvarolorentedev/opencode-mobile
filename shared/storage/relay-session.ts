import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';
import { RELAY_SESSION_STORAGE_KEY } from '@/shared/storage/keys';

export type RelaySession = { relayUrl: string; username: string; token: string };

const RELAY_CREDENTIAL_STORAGE_KEY = 'opencode-mobile.relay-session-credential';
const MAX_TOKEN_LENGTH = 4096;

let generation = 0;
let operations: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

function isSafeRelayUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7E]+$/.test(value);
}

async function readCredential() {
  if (Platform.OS === 'web') return getConnectTestSecret(RELAY_CREDENTIAL_STORAGE_KEY);
  return (await SecureStore.getItemAsync(RELAY_CREDENTIAL_STORAGE_KEY)) ?? '';
}

async function writeCredential(value: string) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(RELAY_CREDENTIAL_STORAGE_KEY, value);
    return;
  }
  if (value) {
    await SecureStore.setItemAsync(RELAY_CREDENTIAL_STORAGE_KEY, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(RELAY_CREDENTIAL_STORAGE_KEY);
  }
}

export async function loadRelaySession(): Promise<RelaySession | null> {
  const startedAt = generation;
  const result = await serialize(async () => {
    let raw: string | null;
    try { raw = await AsyncStorage.getItem(RELAY_SESSION_STORAGE_KEY); } catch { return { session: null, corrupt: false }; }
    if (generation !== startedAt || !raw) return { session: null, corrupt: false };
    let metadata: unknown;
    try { metadata = JSON.parse(raw); } catch { return { session: null, corrupt: true }; }
    if (!isRecord(metadata) || !isSafeRelayUrl(metadata.relayUrl) || typeof metadata.username !== 'string' || !metadata.username.trim() || metadata.username.length > 256) {
      return { session: null, corrupt: true };
    }
    let stored: string;
    try { stored = await readCredential(); } catch { return { session: null, corrupt: false }; }
    if (generation !== startedAt) return { session: null, corrupt: false };
    let credential: unknown;
    try { credential = JSON.parse(stored); } catch { return { session: null, corrupt: true }; }
    if (!isRecord(credential) || credential.relayUrl !== metadata.relayUrl || credential.username !== metadata.username || !validToken(credential.token)) {
      return { session: null, corrupt: true };
    }
    return { session: { relayUrl: metadata.relayUrl, username: metadata.username, token: credential.token }, corrupt: false };
  });
  if (result.corrupt && generation === startedAt) await clearRelaySession().catch(() => undefined);
  return result.session;
}

export async function saveRelaySession(session: RelaySession): Promise<void> {
  if (!isSafeRelayUrl(session.relayUrl) || !session.username.trim() || session.username.length > 256 || !validToken(session.token)) {
    throw new Error('Invalid relay session.');
  }
  const startedAt = generation;
  await serialize(async () => {
    if (startedAt !== generation) return;
    await AsyncStorage.removeItem(RELAY_SESSION_STORAGE_KEY);
    try {
      await writeCredential(JSON.stringify(session));
      if (startedAt !== generation) {
        await writeCredential('');
        return;
      }
      await AsyncStorage.setItem(RELAY_SESSION_STORAGE_KEY, JSON.stringify({ relayUrl: session.relayUrl, username: session.username }));
    } catch (error) {
      await AsyncStorage.removeItem(RELAY_SESSION_STORAGE_KEY).catch(() => undefined);
      await writeCredential('').catch(() => undefined);
      throw error;
    }
  });
}

export async function clearRelaySession(): Promise<void> {
  generation += 1;
  await serialize(async () => {
    await AsyncStorage.removeItem(RELAY_SESSION_STORAGE_KEY);
    await writeCredential('');
  });
}
