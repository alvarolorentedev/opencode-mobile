import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_STORAGE_KEY } from '@/shared/storage/keys';
import { stripServerUrlCredentials } from '@/shared/contracts/server-url';

const CONNECTION_PASSWORD_STORAGE_KEY = 'opencode-mobile.connection-password';

type StoredConnectionSettings = Omit<OpencodeConnectionSettings, 'password' | 'headers'>;

// Everything that must stay out of AsyncStorage: credentials and gateway
// headers. Header secrets live under their own SecureStore keys.
export function withoutConnectionSecrets(settings: OpencodeConnectionSettings): StoredConnectionSettings {
  const { password: _password, headers: _headers, ...storedSettings } = settings;
  return { ...storedSettings, serverUrl: stripServerUrlCredentials(storedSettings.serverUrl) };
}

export async function getConnectionPassword() {
  if (Platform.OS === 'web') {
    return getConnectTestSecret(CONNECTION_PASSWORD_STORAGE_KEY);
  }
  const password = await SecureStore.getItemAsync(CONNECTION_PASSWORD_STORAGE_KEY);
  if (password) {
    return password;
  }

  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return '';
    }
    const settings = JSON.parse(raw) as Record<string, unknown>;
    if (typeof settings.password !== 'string') {
      return '';
    }
    const { password: legacyPassword, ...storedSettings } = settings;
    if (typeof storedSettings.serverUrl === 'string') storedSettings.serverUrl = stripServerUrlCredentials(storedSettings.serverUrl);
    await SecureStore.setItemAsync(CONNECTION_PASSWORD_STORAGE_KEY, legacyPassword);
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(storedSettings));
    return legacyPassword;
  } catch {
    return '';
  }
}

export async function saveConnectionPassword(password: string, background = false) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(CONNECTION_PASSWORD_STORAGE_KEY, password);
    return;
  }
  if (password) {
    await SecureStore.setItemAsync(CONNECTION_PASSWORD_STORAGE_KEY, password, background ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } : undefined);
    return;
  }

  await SecureStore.deleteItemAsync(CONNECTION_PASSWORD_STORAGE_KEY);
}
