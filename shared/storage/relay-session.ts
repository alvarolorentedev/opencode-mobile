import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { RELAY_SESSION_STORAGE_KEY } from '@/shared/storage/keys';

// The relay account the user signed in with, so discovery does not ask for
// the credentials again on every visit. The session token and the password are
// secrets and live in the Keychain/Keystore; only the non-secret parts sit in
// AsyncStorage.
export type RelaySession = {
  relayUrl: string;
  username: string;
  token: string;
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const RELAY_PASSWORD_KEY = 'opencode-mobile.relay-session-password';

export async function loadRelaySession(): Promise<RelaySession | null> {
  try {
    const raw = await AsyncStorage.getItem(RELAY_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RelaySession>;
    if (!parsed.relayUrl || !parsed.username || !parsed.token) return null;
    return { relayUrl: parsed.relayUrl, username: parsed.username, token: parsed.token };
  } catch {
    return null;
  }
}

export async function saveRelaySession(session: RelaySession, password: string) {
  await AsyncStorage.setItem(RELAY_SESSION_STORAGE_KEY, JSON.stringify(session));
  await SecureStore.setItemAsync(RELAY_PASSWORD_KEY, password, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function getRelayPassword(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(RELAY_PASSWORD_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function clearRelaySession() {
  await AsyncStorage.removeItem(RELAY_SESSION_STORAGE_KEY);
  try {
    await SecureStore.deleteItemAsync(RELAY_PASSWORD_KEY);
  } catch {
    // The session metadata is already gone; a stale password is harmless.
  }
}
