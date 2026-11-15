import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const ciphertexts = new Map<string, string>();
  return {
    ciphertexts,
    generate: vi.fn(),
    importKey: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    keyRead: vi.fn(),
    keyWrite: vi.fn(),
    cipherRead: vi.fn(),
    cipherWrite: vi.fn(),
    cipherRemove: vi.fn(),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: mocks.cipherRead, setItem: mocks.cipherWrite, removeItem: mocks.cipherRemove },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.keyRead,
  setItemAsync: mocks.keyWrite,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device',
}));
vi.mock('@/shared/storage/cloud-link', () => ({
  getConnectTestSecret: () => '',
  setConnectTestSecret: () => {},
}));
vi.mock('expo-crypto', () => ({
  AESEncryptionKey: { generate: mocks.generate, import: mocks.importKey },
  AESSealedData: { fromCombined: (value: string) => ({ value }) },
  aesEncryptAsync: mocks.encrypt,
  aesDecryptAsync: mocks.decrypt,
}));

const key = { marker: 'key' };
const certificate = {
  pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  fingerprint: 'a'.repeat(64),
  subject: 'CN=test',
  issuer: 'CN=test',
  notBefore: '2026-01-01T00:00:00Z',
  notAfter: '2027-01-01T00:00:00Z',
  kind: 'ca' as const,
  count: 1,
};
const profileKey = 'opencode-mobile.connection-profile-certificate.a';

beforeEach(() => {
  vi.resetModules();
  mocks.ciphertexts.clear();
  for (const mock of [mocks.generate, mocks.importKey, mocks.encrypt, mocks.decrypt, mocks.keyRead, mocks.keyWrite, mocks.cipherRead, mocks.cipherWrite, mocks.cipherRemove]) mock.mockReset();
  mocks.generate.mockResolvedValue({ encoded: async () => 'generated-key' });
  mocks.importKey.mockResolvedValue(key);
  mocks.encrypt.mockImplementation(async (bytes: Uint8Array) => ({ combined: async () => `sealed:${new TextDecoder().decode(bytes)}` }));
  mocks.decrypt.mockImplementation(async (sealed: { value: string }) => new TextEncoder().encode(sealed.value.replace(/^sealed:/, '')));
  mocks.keyRead.mockResolvedValue(null);
  mocks.keyWrite.mockResolvedValue(undefined);
  mocks.cipherRead.mockImplementation(async (storageKey: string) => mocks.ciphertexts.get(storageKey) ?? null);
  mocks.cipherWrite.mockImplementation(async (storageKey: string, value: string) => { mocks.ciphertexts.set(storageKey, value); });
  mocks.cipherRemove.mockImplementation(async (storageKey: string) => { mocks.ciphertexts.delete(storageKey); });
});

describe('connection certificate encryption', () => {
  it('creates one key for concurrent first saves', async () => {
    const { saveProfileCertificate } = await import('@/shared/storage/connection-certificates');
    await Promise.all([saveProfileCertificate('a', certificate), saveProfileCertificate('b', certificate)]);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.keyWrite).toHaveBeenCalledOnce();
    expect(mocks.keyWrite).toHaveBeenCalledWith('opencode-mobile.connection-certificate-key', 'generated-key', expect.anything());
    expect(mocks.cipherWrite).toHaveBeenCalledTimes(2);
  });

  it('keeps a stored certificate when the keychain read fails', async () => {
    const { getProfileCertificate } = await import('@/shared/storage/connection-certificates');
    mocks.ciphertexts.set(profileKey, 'sealed:{}');
    mocks.keyRead.mockRejectedValue(new Error('keychain unavailable'));
    await expect(getProfileCertificate('a')).resolves.toBeUndefined();
    expect(mocks.keyWrite).not.toHaveBeenCalled();
    expect(mocks.cipherRemove).not.toHaveBeenCalled();
  });

  it('reads back a saved certificate', async () => {
    const { getProfileCertificate, saveProfileCertificate } = await import('@/shared/storage/connection-certificates');
    await saveProfileCertificate('a', certificate);
    await expect(getProfileCertificate('a')).resolves.toEqual(certificate);
  });

  it('clears an invalid payload', async () => {
    const { getProfileCertificate } = await import('@/shared/storage/connection-certificates');
    mocks.ciphertexts.set(profileKey, 'sealed:not-json');
    await expect(getProfileCertificate('a')).resolves.toBeUndefined();
    expect(mocks.cipherRemove).toHaveBeenCalledWith(profileKey);
  });
});
