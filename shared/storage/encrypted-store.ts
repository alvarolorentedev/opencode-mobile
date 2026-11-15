import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectTestSecret, setConnectTestSecret } from '@/shared/storage/cloud-link';

// AES-256-GCM values whose key lives in Keychain/Keystore and whose ciphertext
// lives in AsyncStorage. Key creation is single-flight so concurrent first
// reads or writes cannot generate competing keys.
export function createEncryptedStore(keyStorageKey: string) {
  let cachedKey: Promise<AESEncryptionKey> | undefined;

  async function readKeyMaterial() {
    if (Platform.OS === 'web') return getConnectTestSecret(keyStorageKey);
    return (await SecureStore.getItemAsync(keyStorageKey)) ?? '';
  }

  async function writeKeyMaterial(value: string) {
    if (Platform.OS === 'web') {
      setConnectTestSecret(keyStorageKey, value);
      return;
    }
    await SecureStore.setItemAsync(keyStorageKey, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  async function createKey() {
    let encoded = await readKeyMaterial();
    if (!encoded) {
      const generated = await AESEncryptionKey.generate();
      encoded = await generated.encoded('base64');
      await writeKeyMaterial(encoded);
    }
    return AESEncryptionKey.import(encoded, 'base64');
  }

  // A rejected creation is not cached: the next caller retries instead of
  // inheriting a transient Keychain/Keystore failure.
  function key() {
    if (!cachedKey) cachedKey = createKey().catch((error) => { cachedKey = undefined; throw error; });
    return cachedKey;
  }

  async function readCiphertext(storageKey: string) {
    if (Platform.OS === 'web') return getConnectTestSecret(storageKey);
    return (await AsyncStorage.getItem(storageKey)) ?? '';
  }

  async function writeCiphertext(storageKey: string, value: string) {
    if (Platform.OS === 'web') {
      setConnectTestSecret(storageKey, value);
      return;
    }
    if (value) {
      await AsyncStorage.setItem(storageKey, value);
      return;
    }
    await AsyncStorage.removeItem(storageKey);
  }

  async function encrypt(encryptionKey: AESEncryptionKey, aad: string, plaintext: string) {
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(plaintext),
      encryptionKey,
      { additionalData: new TextEncoder().encode(aad) },
    );
    return sealed.combined('base64');
  }

  async function decrypt(encryptionKey: AESEncryptionKey, aad: string, ciphertext: string) {
    const sealed = AESSealedData.fromCombined(ciphertext, { ivLength: 12, tagLength: 16 });
    const bytes = await aesDecryptAsync(sealed, encryptionKey, {
      output: 'bytes',
      additionalData: new TextEncoder().encode(aad),
    });
    return new TextDecoder().decode(bytes);
  }

  return { key, readCiphertext, writeCiphertext, encrypt, decrypt };
}
