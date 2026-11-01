import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';
import { parseStoredConnectionCertificate, type ConnectionCertificate } from '@/shared/contracts/connection-certificate';

const CERTIFICATE_KEY_STORAGE_KEY = 'opencode-mobile.connection-certificate-key';
const CONNECTION_CERTIFICATE_STORAGE_KEY = 'opencode-mobile.connection-certificate';

function profileCertificateKey(profileId: string) {
  return `opencode-mobile.connection-profile-certificate.${profileId}`;
}

function certificateAad(id: string) {
  return new TextEncoder().encode(`opencode-mobile:connection-certificate:${id}`);
}

async function readKeyMaterial() {
  try {
    if (Platform.OS === 'web') return getConnectTestSecret(CERTIFICATE_KEY_STORAGE_KEY);
    return (await SecureStore.getItemAsync(CERTIFICATE_KEY_STORAGE_KEY)) ?? '';
  } catch {
    return '';
  }
}

async function writeKeyMaterial(value: string) {
  if (Platform.OS === 'web') {
    setConnectTestSecret(CERTIFICATE_KEY_STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(CERTIFICATE_KEY_STORAGE_KEY, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

let cachedKey: AESEncryptionKey | undefined;

async function certificateKey() {
  if (cachedKey) return cachedKey;
  let encoded = await readKeyMaterial();
  if (!encoded) {
    const generated = await AESEncryptionKey.generate();
    encoded = await generated.encoded('base64');
    await writeKeyMaterial(encoded);
  }
  cachedKey = await AESEncryptionKey.import(encoded, 'base64');
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

async function encryptCertificate(id: string, certificate: ConnectionCertificate) {
  const key = await certificateKey();
  const sealed = await aesEncryptAsync(
    new TextEncoder().encode(JSON.stringify(certificate)),
    key,
    { additionalData: certificateAad(id) },
  );
  return sealed.combined('base64');
}

async function decryptCertificate(id: string, ciphertext: string): Promise<ConnectionCertificate | undefined> {
  if (!ciphertext) return undefined;
  try {
    const key = await certificateKey();
    const sealed = AESSealedData.fromCombined(ciphertext, { ivLength: 12, tagLength: 16 });
    const bytes = await aesDecryptAsync(sealed, key, { output: 'bytes', additionalData: certificateAad(id) });
    return parseStoredConnectionCertificate(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

async function readCertificate(id: string, storageKey: string) {
  const ciphertext = await readCiphertext(storageKey).catch(() => '');
  if (!ciphertext) return undefined;
  const certificate = await decryptCertificate(id, ciphertext);
  if (!certificate) {
    // A missing key, failed tag, or malformed payload must fail closed.
    await writeCiphertext(storageKey, '').catch(() => undefined);
  }
  return certificate;
}

async function saveCertificate(id: string, storageKey: string, certificate: ConnectionCertificate | undefined) {
  if (!certificate) {
    await writeCiphertext(storageKey, '');
    return;
  }
  const ciphertext = await encryptCertificate(id, certificate);
  try {
    await writeCiphertext(storageKey, ciphertext);
  } catch (error) {
    await writeCiphertext(storageKey, '').catch(() => undefined);
    throw error;
  }
}

export function getConnectionCertificate() {
  return readCertificate('active', CONNECTION_CERTIFICATE_STORAGE_KEY);
}

export function saveConnectionCertificate(certificate: ConnectionCertificate | undefined) {
  return saveCertificate('active', CONNECTION_CERTIFICATE_STORAGE_KEY, certificate);
}

export function getProfileCertificate(profileId: string) {
  return readCertificate(profileId, profileCertificateKey(profileId));
}

export function saveProfileCertificate(profileId: string, certificate: ConnectionCertificate | undefined) {
  return saveCertificate(profileId, profileCertificateKey(profileId), certificate);
}

export function deleteProfileCertificate(profileId: string) {
  return writeCiphertext(profileCertificateKey(profileId), '');
}
