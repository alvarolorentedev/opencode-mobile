import * as SecureStore from 'expo-secure-store';

import { Platform } from 'react-native';
import { isConnectEnabled, requireControlPlane, parseConnectSession, parseConnectPairing, type ConnectStore, type ConnectSession, type ConnectPairing } from '@/shared/contracts/cloud-link';

// Web credentials exist only in the explicit development E2E build and vanish
// on reload. Product web builds continue to have no credential persistence.
const testSecrets = new Map<string, string>();

export function getConnectTestSecret(key: string) {
  return isConnectEnabled() && Platform.OS === 'web' ? testSecrets.get(key) ?? '' : '';
}

export function setConnectTestSecret(key: string, value: string) {
  if (isConnectEnabled() && Platform.OS === 'web') {
    const fixture = globalThis as typeof globalThis & { __connectSecureWriteFailure?: boolean };
    if (fixture.__connectSecureWriteFailure && key.includes('connect-session')) { fixture.__connectSecureWriteFailure = false; throw new Error('Secure storage unavailable.'); }
    if (value) testSecrets.set(key, value); else testSecrets.delete(key);
  }
}

function secureKey(controlPlaneUrl: string, store: ConnectStore, kind: string) {
  const segment = Array.from(requireControlPlane(controlPlaneUrl)).map((char) => char.charCodeAt(0).toString(16)).join('-');
  return `opencode-mobile.connect-${kind}.${store}.${segment}`;
}

async function readSecret(key: string) {
  return Platform.OS === 'web' ? getConnectTestSecret(key) : await SecureStore.getItemAsync(key) ?? '';
}

async function writeSecret(key: string, value: string) {
  if (Platform.OS === 'web') { setConnectTestSecret(key, value); return; }
  if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}

export async function getConnectSession(controlPlaneUrl: string, store: ConnectStore) {
  const raw = await readSecret(secureKey(controlPlaneUrl, store, 'session'));
  if (!raw) return undefined;
  try { return parseConnectSession(JSON.parse(raw)); } catch { await writeSecret(secureKey(controlPlaneUrl, store, 'session'), ''); return undefined; }
}

export async function saveConnectSession(controlPlaneUrl: string, store: ConnectStore, session: ConnectSession) {
  await writeSecret(secureKey(controlPlaneUrl, store, 'session'), JSON.stringify(parseConnectSession(session)));
}

export async function savePendingConnectPairing(controlPlaneUrl: string, store: ConnectStore, pairing?: ConnectPairing) {
  await writeSecret(secureKey(controlPlaneUrl, store, 'pairing'), pairing ? JSON.stringify(pairing) : '');
}

export async function getPendingConnectPairing(controlPlaneUrl: string, store: ConnectStore) {
  const raw = await readSecret(secureKey(controlPlaneUrl, store, 'pairing'));
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as ConnectPairing;
    const result = parseConnectPairing({ v: '1', cp: value.controlPlaneUrl, id: value.pairingId, t: value.pairingToken, n: value.machineName }, controlPlaneUrl);
    if (result.controlPlaneUrl !== requireControlPlane(controlPlaneUrl)) throw new Error();
    return result;
  } catch { await savePendingConnectPairing(controlPlaneUrl, store); return undefined; }
}
