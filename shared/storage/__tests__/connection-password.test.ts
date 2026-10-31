import { describe, expect, it } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

// shared/storage/connection-password.ts is the only place that reads or writes the active
// connection password. It keeps the secret in SecureStore, strips it from
// persisted settings, and migrates legacy plaintext settings out of
// AsyncStorage. This suite drives the real module with stubbed native
// boundaries so the behavior (not the source text) is what is asserted.
async function loadPasswordModule(platform: 'android' | 'ios' | 'web' = 'android') {
  const secure = new Map<string, string>();
  const storage = new Map<string, string>();
  const connectSecrets = new Map<string, string>();

  const url = await loadTs('shared/contracts/server-url.ts', {
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://localhost' } }
  });
  const storageKeys = await loadTs('shared/storage/keys.ts');

  const module = await loadTs('shared/storage/connection-password.ts', {
    'expo-secure-store': {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock',
      getItemAsync: async (key: string) => secure.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => { secure.set(key, value); },
      deleteItemAsync: async (key: string) => { secure.delete(key); },
    },
    'react-native': { Platform: { OS: platform } },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => { storage.set(key, value); },
      },
    },
    '@/shared/storage/keys': storageKeys,
    '@/shared/contracts/server-url': url,
    "@/shared/storage/cloud-link": { getConnectTestSecret: (key: string) => connectSecrets.get(key) ?? '', setConnectTestSecret: (key: string, value: string) => { connectSecrets.set(key, value); } }
  });

  return { module, secure, storage, connectSecrets, settingsKey: storageKeys.SETTINGS_STORAGE_KEY };
}

const PASSWORD_KEY = 'opencode-mobile.connection-password';

describe('connection password storage', () => {
  it('strips credentials, gateway headers, and URL credentials from persisted settings', async () => {
    const { module } = await loadPasswordModule();
    expect(module.withoutConnectionSecrets({
      serverUrl: 'https://alice:secret@host.test/proxy',
      username: 'alice',
      password: 'secret',
      headers: { 'CF-Access-Client-Secret': 'gateway-secret' },
    })).toEqual({ serverUrl: 'https://host.test/proxy', username: 'alice' });
  });

  it('returns the SecureStore value without touching AsyncStorage', async () => {
    const { module, secure, storage, settingsKey } = await loadPasswordModule();
    secure.set(PASSWORD_KEY, 'secure-secret');
    storage.set(settingsKey, JSON.stringify({ serverUrl: 'https://host.test', password: 'legacy' }));

    expect(await module.getConnectionPassword()).toBe('secure-secret');
    // The legacy AsyncStorage value is left as-is once a secure value exists.
    expect(storage.get(settingsKey)).toBe(JSON.stringify({ serverUrl: 'https://host.test', password: 'legacy' }));
  });

  it('migrates legacy plaintext settings into SecureStore and strips them', async () => {
    const { module, secure, storage, settingsKey } = await loadPasswordModule();
    storage.set(settingsKey, JSON.stringify({
      serverUrl: 'https://alice:secret@host.test/proxy',
      username: 'alice',
      password: 'legacy-secret',
      extra: 'kept',
    }));

    expect(await module.getConnectionPassword()).toBe('legacy-secret');
    expect(secure.get(PASSWORD_KEY)).toBe('legacy-secret');
    const rewritten = JSON.parse(storage.get(settingsKey) as string);
    expect(rewritten).toEqual({ serverUrl: 'https://host.test/proxy', username: 'alice', extra: 'kept' });
    expect(storage.get(settingsKey)).not.toContain('legacy-secret');
  });

  it('reports no password for missing, non-string, or malformed settings', async () => {
    for (const stored of [undefined, '{}', '{"password":42}', '{not json']) {
      const { module, storage, settingsKey } = await loadPasswordModule();
      if (stored !== undefined) storage.set(settingsKey, stored);
      expect(await module.getConnectionPassword()).toBe('');
    }
  });

  it('writes and clears the SecureStore entry on save', async () => {
    const { module, secure } = await loadPasswordModule();
    await module.saveConnectionPassword('saved');
    expect(secure.get(PASSWORD_KEY)).toBe('saved');

    await module.saveConnectionPassword('backgrounded', true);
    expect(secure.get(PASSWORD_KEY)).toBe('backgrounded');

    await module.saveConnectionPassword('');
    expect(secure.has(PASSWORD_KEY)).toBe(false);
  });

  it('uses the connect test secret on web instead of SecureStore', async () => {
    const { module, secure, connectSecrets } = await loadPasswordModule('web');
    await module.saveConnectionPassword('web-secret');
    expect(connectSecrets.get(PASSWORD_KEY)).toBe('web-secret');
    expect(secure.has(PASSWORD_KEY)).toBe(false);
    expect(await module.getConnectionPassword()).toBe('web-secret');
  });
});
