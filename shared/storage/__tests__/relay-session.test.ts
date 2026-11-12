import { describe, expect, it } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

async function loadRelayStore(platform: 'android' | 'ios' | 'web' = 'android', beforeSecureWrite: () => Promise<void> = async () => {}) {
  const secure = new Map<string, string>();
  const storage = new Map<string, string>();
  const testSecrets = new Map<string, string>();
  const storageKeys = await loadTs('shared/storage/keys.ts');
  const module = await loadTs('shared/storage/relay-session.ts', {
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => { storage.set(key, value); },
        removeItem: async (key: string) => { storage.delete(key); },
      },
    },
    'expo-secure-store': {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
      getItemAsync: async (key: string) => secure.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => { await beforeSecureWrite(); secure.set(key, value); },
      deleteItemAsync: async (key: string) => { secure.delete(key); },
    },
    'react-native': { Platform: { OS: platform } },
    '@/shared/storage/cloud-link': {
      getConnectTestSecret: (key: string) => testSecrets.get(key) ?? '',
      setConnectTestSecret: (key: string, value: string) => { if (value) testSecrets.set(key, value); else testSecrets.delete(key); },
    },
    '@/shared/storage/keys': storageKeys,
  });
  return { module, secure, storage, testSecrets, storageKey: storageKeys.RELAY_SESSION_STORAGE_KEY };
}

describe('relay session storage', () => {
  it('keeps bearer credentials out of AsyncStorage and does not persist the relay password', async () => {
    const { module, secure, storage, storageKey } = await loadRelayStore();
    const session = { relayUrl: 'https://relay.example.com', username: 'alice', token: 'bearer-secret' };
    await module.saveRelaySession(session);

    expect(JSON.parse(storage.get(storageKey) as string)).toEqual({ relayUrl: session.relayUrl, username: session.username });
    expect(storage.get(storageKey)).not.toContain(session.token);
    expect([...secure.values()].join()).toContain(session.token);
    await expect(module.loadRelaySession()).resolves.toEqual(session);
  });

  it('rejects and clears malformed or mismatched persisted data', async () => {
    const { module, secure, storage, storageKey } = await loadRelayStore();
    storage.set(storageKey, JSON.stringify({ relayUrl: 'http://relay.example.com', username: 'alice' }));
    secure.set('opencode-mobile.relay-session-credential', JSON.stringify({ relayUrl: 'http://relay.example.com', username: 'alice', token: 'secret' }));
    await expect(module.loadRelaySession()).resolves.toBeNull();
    expect(storage.has(storageKey)).toBe(false);
    expect(secure.has('opencode-mobile.relay-session-credential')).toBe(false);
  });

  it('clears metadata and the protected token on sign out', async () => {
    const { module, secure, storage, storageKey } = await loadRelayStore();
    await module.saveRelaySession({ relayUrl: 'https://relay.example.com', username: 'alice', token: 'bearer-secret' });
    await module.clearRelaySession();
    await expect(module.loadRelaySession()).resolves.toBeNull();
    expect(storage.has(storageKey)).toBe(false);
    expect(secure.has('opencode-mobile.relay-session-credential')).toBe(false);
  });

  it('uses the secure test-secret adapter on web', async () => {
    const { module, secure, testSecrets } = await loadRelayStore('web');
    await module.saveRelaySession({ relayUrl: 'https://relay.example.com', username: 'alice', token: 'web-token' });
    expect([...testSecrets.values()].join()).toContain('web-token');
    expect(secure.size).toBe(0);
    await module.clearRelaySession();
    expect(testSecrets.size).toBe(0);
  });

  it('does not let an in-flight save restore credentials after sign out', async () => {
    let started!: () => void;
    let release!: () => void;
    const writeStarted = new Promise<void>((resolve) => { started = resolve; });
    const writeGate = new Promise<void>((resolve) => { release = resolve; });
    const { module, secure, storage, storageKey } = await loadRelayStore('android', async () => { started(); await writeGate; });
    const save = module.saveRelaySession({ relayUrl: 'https://relay.example.com', username: 'alice', token: 'stale-token' });
    await writeStarted;
    const clear = module.clearRelaySession();
    release();
    await Promise.all([save, clear]);
    expect(storage.has(storageKey)).toBe(false);
    expect(secure.has('opencode-mobile.relay-session-credential')).toBe(false);
  });
});
