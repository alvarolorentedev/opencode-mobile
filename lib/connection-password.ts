import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_STORAGE_KEY } from '@/lib/storage-keys';

const CONNECTION_PASSWORD_STORAGE_KEY = 'opencode-mobile.connection-password';

export type StoredConnectionSettings = Omit<OpencodeConnectionSettings, 'password'>;

export function withoutConnectionPassword(settings: OpencodeConnectionSettings): StoredConnectionSettings {
  const { password: _password, ...storedSettings } = settings;
  return storedSettings;
}

export async function getConnectionPassword() {
  if (Platform.OS === 'web') {
    return '';
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
    await SecureStore.setItemAsync(CONNECTION_PASSWORD_STORAGE_KEY, legacyPassword);
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(storedSettings));
    return legacyPassword;
  } catch {
    return '';
  }
}

export async function saveConnectionPassword(password: string) {
  if (Platform.OS === 'web') {
    return;
  }
  if (password) {
    await SecureStore.setItemAsync(CONNECTION_PASSWORD_STORAGE_KEY, password);
    return;
  }

  await SecureStore.deleteItemAsync(CONNECTION_PASSWORD_STORAGE_KEY);
}
