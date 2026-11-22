import { vi } from 'vitest';

import { CONNECTION_PROFILES_STORAGE_KEY } from '@/shared/storage/keys';

const device = vi.hoisted(() => ({
  config: {} as any, os: 'ios',
  secrets: new Map<string, string>(),
  preferences: new Map<string, string>(),
  failSecureWrite: false,
  subscriptionEvents: undefined as string[] | undefined,
  onSaveProfile: undefined as (() => void) | undefined,
  appState: undefined as ((listener: (state: string) => void) => void | (() => void)) | undefined,
  billing: {} as Record<string, (...args: any[]) => any>,
  onSecretWrite: undefined as (() => void) | undefined,
  state: 'active',
}));

vi.mock('expo-constants', () => ({ default: { get expoConfig() { return device.config; } } }));
vi.mock('react-native', () => ({
  Platform: { get OS() { return device.os; } },
  AppState: { get currentState() { return device.state; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    return { remove: device.appState?.(listener) ?? (() => {}) };
  } },
}));
vi.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }));
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
  getItem: async (key: string) => device.preferences.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    device.preferences.set(key, value);
    if (key === CONNECTION_PROFILES_STORAGE_KEY) device.onSaveProfile?.();
  },
  removeItem: async (key: string) => { device.preferences.delete(key); },
} }));
vi.mock('expo-iap', () => Object.fromEntries([
  'initConnection', 'endConnection', 'fetchProducts', 'requestPurchase', 'getAvailablePurchases',
  'restorePurchases', 'deepLinkToSubscriptions', 'finishTransaction', 'getTransactionJwsIOS',
  'isEligibleForIntroOfferIOS', 'getPendingTransactionsIOS', 'purchaseUpdatedListener', 'purchaseErrorListener',
].map((name) => [name, (...args: any[]) => device.billing[name](...args)])));
export { device as cloudLinkPlatform };
