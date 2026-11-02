import { describe, expect, it, vi } from 'vitest';
import { saveOidcTokens } from '@/shared/storage/connection-oidc';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), import: vi.fn(), encrypt: vi.fn(), saveKey: vi.fn(), ciphertext: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { setItem: mocks.ciphertext } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: mocks.saveKey, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device' }));
vi.mock('@/shared/storage/cloud-link', () => ({}));
vi.mock('expo-crypto', () => ({ AESEncryptionKey: { generate: mocks.generate, import: mocks.import }, aesEncryptAsync: mocks.encrypt }));

describe('OIDC encryption key ownership', () => {
  it('single-flights key creation for concurrent first saves on different connections', async () => {
    const key = { encoded: async () => 'synthetic-key' };
    mocks.generate.mockResolvedValue(key); mocks.import.mockResolvedValue(key);
    mocks.encrypt.mockResolvedValue({ combined: async () => 'synthetic-ciphertext' });
    const tokens = { accessToken: 'synthetic', expiresAt: 1, tokenType: 'Bearer', issuer: 'https://idp.test', clientId: 'app' };
    await Promise.all([saveOidcTokens('connection-a', tokens), saveOidcTokens('connection-b', tokens)]);
    expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.saveKey).toHaveBeenCalledOnce();
    expect(mocks.encrypt).toHaveBeenCalledTimes(2);
    expect(mocks.encrypt.mock.calls.every((args) => args[1] === key)).toBe(true);
    expect(mocks.ciphertext).toHaveBeenCalledTimes(2);
  });
});
