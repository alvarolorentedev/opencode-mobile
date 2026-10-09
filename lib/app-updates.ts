import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

export type UpdatePhase = 'none' | 'available' | 'downloading' | 'downloaded' | 'installing';
export type UpdateSnapshot = { phase: UpdatePhase; version?: string };
export type UpdateEvent = { phase: UpdatePhase | 'cancelled' | 'failed' };
export type AppUpdateApi = {
  supportsRecovery?: boolean;
  check: () => Promise<UpdateSnapshot>;
  start: () => Promise<boolean>;
  complete: () => Promise<void>;
  subscribe: (listener: (event: UpdateEvent) => void) => () => void;
};

type NativeUpdates = {
  check: AppUpdateApi['check'];
  startFlexibleUpdate: AppUpdateApi['start'];
  completeUpdate: AppUpdateApi['complete'];
  getAppStoreInstallation: () => Promise<{ eligible: boolean; bundleId?: string; installedVersion?: string }>;
  addListener: (event: 'status', callback: (event: UpdateEvent) => void) => { remove: () => void };
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
  startResult?: boolean; startError?: boolean; completeError?: boolean;
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
      supportsRecovery: true,
      check: async () => { test.checks++; return { ...test.snapshot }; },
      start: async () => {
        test.events.push('start');
        if (test.startError) throw new Error('Store unavailable');
        if (test.startResult === false) return false;
        test.snapshot = { ...test.snapshot, phase: 'downloading' };
        test.emit?.({ phase: 'downloading' });
        return true;
      },
      complete: async () => {
        test.events.push('complete');
        if (test.completeError) throw new Error('Installation failed');
      },
      subscribe: (listener) => {
        test.emit = (event) => {
          if (event.phase !== 'failed' && event.phase !== 'cancelled') test.snapshot = { ...test.snapshot, phase: event.phase };
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
  const native = requireOptionalNativeModule<NativeUpdates>('OpencodeUpdates');
  if (!native) return null;
  if (Platform.OS === 'android') return {
    supportsRecovery: true,
    check: () => native.check(), start: () => native.startFlexibleUpdate(), complete: () => native.completeUpdate(),
    subscribe: (callback) => { const subscription = native.addListener('status', callback); return () => subscription.remove(); },
  };

  const country = options.appStoreCountry;
  const lookup = `https://itunes.apple.com/lookup?id=${appId}${typeof country === 'string' && /^[a-z]{2}$/i.test(country) ? `&country=${country}` : ''}`;
  const destination = `https://apps.apple.com/app/id${appId}`;
  return {
    check: async () => {
      const installation = await native.getAppStoreInstallation();
      if (!installation.eligible || typeof installation.bundleId !== 'string' || installation.bundleId !== config?.ios?.bundleIdentifier || !installation.installedVersion) return { phase: 'none' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(lookup, { signal: controller.signal });
        if (!response.ok) throw new Error('App Store lookup failed');
        return appStoreCandidate(await response.json(), appId, installation.bundleId, installation.installedVersion);
      } finally { clearTimeout(timeout); }
    },
    start: async () => { await Linking.openURL(destination); return true; },
    complete: async () => {},
    subscribe: () => () => {},
  };
}
