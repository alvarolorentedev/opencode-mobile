import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';

import { ConnectionHeaders, parseStoredConnectionHeaders, hasConnectionHeaders } from '@/shared/contracts/connection-headers';

const CONNECTION_HEADERS_STORAGE_KEY = 'opencode-mobile.connection-headers';

async function readSecret(key: string) {
  try {
    if (Platform.OS === 'web') return getConnectTestSecret(key);
    return (await SecureStore.getItemAsync(key)) ?? '';
  } catch {
    return '';
  }
}

async function writeSecret(key: string, value: string) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(key, value);
    return;
  }
  if (value) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function serialize(headers: ConnectionHeaders | undefined) {
  return hasConnectionHeaders(headers) ? JSON.stringify(parseStoredConnectionHeaders(headers)) : '';
}

function parseSecret(raw: string) {
  if (!raw) return {};
  try {
    return parseStoredConnectionHeaders(JSON.parse(raw));
  } catch {
    return {};
  }
}

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
function profileHeadersKey(profileId: string) {
  return `opencode-mobile.connection-profile-headers.${profileId}`;
}

export async function getConnectionHeaders(): Promise<ConnectionHeaders> {
  return parseSecret(await readSecret(CONNECTION_HEADERS_STORAGE_KEY));
}

export async function saveConnectionHeaders(headers: ConnectionHeaders | undefined) {
  await writeSecret(CONNECTION_HEADERS_STORAGE_KEY, serialize(headers));
}

export async function getProfileHeaders(profileId: string): Promise<ConnectionHeaders> {
  return parseSecret(await readSecret(profileHeadersKey(profileId)));
}

export async function saveProfileHeaders(profileId: string, headers: ConnectionHeaders | undefined) {
  await writeSecret(profileHeadersKey(profileId), serialize(headers));
}

export async function deleteProfileHeaders(profileId: string) {
  await writeSecret(profileHeadersKey(profileId), '');
}
