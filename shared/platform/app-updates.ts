import * as Application from 'expo-application';
import { createAndroidAppUpdates } from '@/shared/platform/android-app-updates';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

export type UpdatePhase = 'none' | 'available' | 'inProgress';
export type UpdateSnapshot = { phase: UpdatePhase; version?: string };
export type UpdateEvent = { phase: UpdatePhase | 'cancelled' | 'failed'; version?: string };
export type AppUpdateApi = {
  nativeConsent?: boolean;
  supportsRecovery?: boolean;
  check: () => Promise<UpdateSnapshot>;
  start: (isSafe: () => boolean) => Promise<boolean>;
  subscribe: (listener: (event: UpdateEvent) => void) => () => void;
};

// Apple release versions are numeric components, not general semver or Android version codes.
export function isNewerStoreVersion(store: unknown, installed: unknown) {
  const parts = (value: unknown) => typeof value === 'string' && /^\d+(\.\d+){0,2}$/.test(value)
    ? value.split('.').map(Number) : undefined;
  const next = parts(store), current = parts(installed);
  if (!next || !current || [...next, ...current].some((value) => !Number.isSafeInteger(value))) return false;
  for (let i = 0; i < 3; i++) {
    const difference = (next[i] ?? 0) - (current[i] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

export function appStoreCandidate(data: unknown, appId: string, bundleId: string, installedVersion: string): UpdateSnapshot {
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) return { phase: 'none' };
  const entry = data.results.find((item: unknown) => item && typeof item === 'object' &&
    'trackId' in item && String(item.trackId) === appId && 'bundleId' in item && item.bundleId === bundleId);
  return entry && isNewerStoreVersion(entry.version, installedVersion)
    ? { phase: 'available', version: entry.version } : { phase: 'none' };
}

type UpdateTest = {
  snapshot: UpdateSnapshot; checks: number; events: string[];
  nativeConsent?: boolean; startResult?: boolean; startError?: boolean;
  emit?: (event: UpdateEvent) => void;
};

export function loadAppUpdates(): AppUpdateApi | null {
  const config = Constants.expoConfig;
  const options = config?.extra?.updates;
  if (Platform.OS === 'web') {
    // Explicit development E2E builds only; ordinary web never resolves native modules.
    const test = config?.extra?.e2eMode && options?.testing
      ? (globalThis as typeof globalThis & { __appUpdateTest?: UpdateTest }).__appUpdateTest : undefined;
    if (!test) return null;
    return {
      nativeConsent: test.nativeConsent !== false,
      supportsRecovery: true,
      check: async () => { test.checks++; return { ...test.snapshot }; },
      start: async (isSafe) => {
        if (!isSafe()) return false;
        test.events.push('start');
        if (test.startError) throw new Error('Store unavailable');
        if (test.startResult === false) return false;
        return true;
      },
      subscribe: (listener) => {
        test.emit = (event) => {
          if (event.phase !== 'failed' && event.phase !== 'cancelled') test.snapshot = { phase: event.phase, version: event.version ?? test.snapshot.version };
          listener(event);
        };
        return () => { delete test.emit; };
      },
    };
  }
  if (!options?.enabled || config?.extra?.foss || config?.extra?.e2eMode ||
    Constants.executionEnvironment === 'storeClient') return null;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  const appId = options.appStoreId;
  if (Platform.OS === 'ios' && (typeof appId !== 'string' || !/^[1-9]\d*$/.test(appId))) return null;
  if (Platform.OS === 'android') return createAndroidAppUpdates();

  const country = options.appStoreCountry;
  const lookup = `https://itunes.apple.com/lookup?id=${appId}${typeof country === 'string' && /^[a-z]{2}$/i.test(country) ? `&country=${country}` : ''}`;
  const destination = `https://apps.apple.com/app/id${appId}`;
  return {
    check: async () => {
      // Tolerate native rejections (e.g. StoreKit failures): an update check must
      // never surface an error or an unhandled rejection, only "no update".
      try {
        if (await Application.getAppleStoreEnvironmentAsync() !== 'production') return { phase: 'none' };
      } catch { return { phase: 'none' }; }
      const bundleId = Application.applicationId;
      const installedVersion = Application.nativeApplicationVersion;
      if (!bundleId || bundleId !== config?.ios?.bundleIdentifier || !installedVersion) return { phase: 'none' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(lookup, { signal: controller.signal });
        if (!response.ok) throw new Error('App Store lookup failed');
        return appStoreCandidate(await response.json(), appId, bundleId, installedVersion);
      } finally { clearTimeout(timeout); }
    },
    start: async (isSafe) => { if (!isSafe()) return false; await Linking.openURL(destination); return true; },
    subscribe: () => () => {},
  };
}
