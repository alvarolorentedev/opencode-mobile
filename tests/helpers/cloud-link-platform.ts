import { vi } from 'vitest';

import { CONNECTION_PROFILES_STORAGE_KEY } from '@/shared/storage/keys';

const device = vi.hoisted(() => ({
  config: {} as any, os: 'ios',
  secrets: new Map<string, string>(),
  preferences: new Map<string, string>(),
  beforePreferenceRead: undefined as ((key: string) => Promise<void>) | undefined,
  beforePreferenceWrite: undefined as ((key: string, value: string) => Promise<void>) | undefined,
  afterPreferenceWrite: undefined as ((key: string, value: string) => Promise<void>) | undefined,
  failSecureWrite: false,
  subscriptionEvents: undefined as string[] | undefined,
  onSaveProfile: undefined as (() => void) | undefined,
  appState: undefined as ((listener: (state: string) => void) => void | (() => void)) | undefined,
  billing: {} as Record<string, (...args: any[]) => any>,
  onSecretWrite: undefined as (() => void) | undefined,
  state: 'active',
}));

vi.mock('expo-constants', () => ({ default: { get expoConfig() { return device.config; } } }));
vi.mock('react-native', async () => ({
  ...(await import('./native-view-platform')).nativeViewPlatform({ get platform() { return device.os; } }),
  AppState: { get currentState() { return device.state; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    return { remove: device.appState?.(listener) ?? (() => {}) };
  } },
}));
vi.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));
vi.mock('expo-crypto', async () => ({
  randomUUID: (await import('node:crypto')).randomUUID,
  AESEncryptionKey: { generate: async () => ({ encoded: async () => 'fixture-key' }), import: async () => ({}) },
  AESSealedData: { fromCombined: (value: string) => ({ value }) },
  aesEncryptAsync: async (bytes: Uint8Array) => ({ combined: async () => Buffer.from(bytes).toString('base64') }),
  aesDecryptAsync: async ({ value }: { value: string }) => Uint8Array.from(Buffer.from(value, 'base64')),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
vi.mock('expo-application', () => ({
  ApplicationReleaseType: { APP_STORE: 'app-store' },
  getIosApplicationReleaseTypeAsync: async () => 'app-store',
  getInstallReferrerAsync: async () => '',
}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-background-task', () => ({}));
vi.mock('expo-notifications', () => ({ AndroidImportance: {} }));
vi.mock('expo-task-manager', () => ({ defineTask() {}, isTaskDefined: () => false }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
  getItemAsync: async (key: string) => device.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (device.failSecureWrite) throw new Error('secure write failed');
    device.subscriptionEvents?.push('secure');
    device.onSecretWrite?.();
    device.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => { device.onSecretWrite?.(); device.secrets.delete(key); },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => { await device.beforePreferenceRead?.(key); return device.preferences.get(key) ?? null; },
  setItem: async (key: string, value: string) => {
    await device.beforePreferenceWrite?.(key, value);
    device.preferences.set(key, value);
    if (key === CONNECTION_PROFILES_STORAGE_KEY) device.onSaveProfile?.();
    await device.afterPreferenceWrite?.(key, value);
  },
  removeItem: async (key: string) => { device.preferences.delete(key); },
} }));
vi.mock('expo-iap', () => Object.fromEntries([
  'initConnection', 'endConnection', 'fetchProducts', 'requestPurchase', 'getAvailablePurchases',
  'restorePurchases', 'deepLinkToSubscriptions', 'finishTransaction', 'getTransactionJwsIOS',
  'isEligibleForIntroOfferIOS', 'getPendingTransactionsIOS', 'purchaseUpdatedListener', 'purchaseErrorListener',
].map((name) => [name, (...args: any[]) => device.billing[name](...args)])));
export { device as cloudLinkPlatform };
