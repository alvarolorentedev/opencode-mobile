import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import { DEFAULT_UPDATE_CHECK_PERIOD, parseUpdatePreferences, UPDATE_CHECK_INTERVALS, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice } from '../model/app-update-policy';
import type { AppUpdateApi, UpdateEvent, UpdateSnapshot } from '../../../shared/platform/app-updates.ts';

const available: UpdateSnapshot = { phase: 'available', version: '59' };
async function provider({ stored = null, readError = false, snapshot = available, recovery = true, nativeConsent = false, blocked = false, check = vi.fn(async () => snapshot) }:
  { stored?: string | null; readError?: boolean; snapshot?: UpdateSnapshot; recovery?: boolean; nativeConsent?: boolean; blocked?: boolean; check?: () => Promise<UpdateSnapshot> } = {}) {
  const runtime = hookRuntime();
  let event: (value: UpdateEvent) => void = () => {};
  let foreground: (value: string) => void = () => {};
  const storage = { getItem: vi.fn(async (_key: string) => { if (readError) throw Error(); return stored; }), setItem: vi.fn(async (_key: string, _value: string) => {}), removeItem: vi.fn(async (_key: string) => {}) };
  const unsubscribe = vi.fn();
  const api: AppUpdateApi = { nativeConsent, supportsRecovery: recovery, check, start: vi.fn(async () => true),
    subscribe: (listener) => { event = listener; return unsubscribe; } };
  const persistence = await loadTs('shared/storage/persistence-hydration.ts');
  const { useAppUpdates } = await loadTs('features/updates/state/use-app-updates.ts', {
    react: runtime.react,
    '@react-native-async-storage/async-storage': storage,
    'react-native': { AppState: { currentState: 'active', addEventListener: (_: string, listener: typeof foreground) => { foreground = listener; return { remove: vi.fn() }; } } },
    '@/shared/storage/persistence-hydration': persistence,
    "@/shared/platform/app-updates": { loadAppUpdates: () => api },
    "@/shared/storage/keys": { APP_UPDATES_STORAGE_KEY: 'updates' },
    "@/features/updates/model/app-update-policy": { DEFAULT_UPDATE_CHECK_PERIOD, parseUpdatePreferences, UPDATE_CHECK_INTERVALS, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice }
  }, runtime.globals);
  runtime.mount(useAppUpdates, { initialized: false, blocked });
  await runtime.settle();
  expect(api.check).not.toHaveBeenCalled();
  runtime.value.setSurfaceActive(true); runtime.update({ initialized: true }); await runtime.settle();
  return { runtime, api, storage, unsubscribe, event: (value: UpdateEvent) => { event(value); runtime.flush(); }, foreground: (value: string) => { foreground(value); runtime.flush(); } };
}

describe('update policy', () => {
  it('validates persistence and preserves legacy download cooldowns', () => {
    expect(() => parseUpdatePreferences('{"lastCheckAt":"bad"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"enabled":"yes"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"checkPeriod":"monthly"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"dismissal":{"version":"59","phase":"other","until":1}}')).toThrow();
    expect(parseUpdatePreferences('{"lastCheckAt":0}')).toEqual({ lastCheckAt: 0, enabled: true, checkPeriod: 'available' });
    const preferences = { lastCheckAt: 0, enabled: true, checkPeriod: 'available' as const, dismissal: { version: '59', phase: 'available' as const, until: 100 } };
    expect(updateNotice(available, preferences, 50)).toBeUndefined();
    expect(parseUpdatePreferences(JSON.stringify({ ...preferences, dismissal: { version: '59', phase: 'downloaded', until: 100 } })).dismissal).toEqual({ version: '59', phase: 'downloaded', until: 100 });
    expect(updateNotice({ phase: 'downloaded', version: '60' }, preferences, 50)).toBeDefined();
    expect(updateNotice({ ...available, version: '60' }, preferences, 50)).toBeDefined();
    expect(updateNotice(available, preferences, 100)).toBeDefined();
    expect(updateCheckDue(100, 99, UPDATE_CHECK_INTERVALS.daily)).toBe(true);
    expect(updateCheckDue(100, 100 + UPDATE_CHECK_INTERVALS.daily - 1, UPDATE_CHECK_INTERVALS.daily)).toBe(false);
    expect(updateCheckDue(100, 100 + UPDATE_CHECK_INTERVALS.daily, UPDATE_CHECK_INTERVALS.daily)).toBe(true);
    expect(updateCheckDue(100, 100, UPDATE_CHECK_INTERVALS.available)).toBe(true);
  });
  it('holds a finished download for an explicit install behind its own cooldown', () => {
    const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '60' };
    const deferred = { lastCheckAt: 0, enabled: true, checkPeriod: 'available' as const, dismissal: { version: '60', phase: 'available' as const, until: 100 } };
    // Deferring the offer never blocks the finished download; only Later on the install does.
    expect(updateNotice(downloaded, deferred, 50)).toBeDefined();
    const installLater = { ...deferred, dismissal: { ...deferred.dismissal, phase: 'downloaded' as const } };
    expect(updateNotice(downloaded, installLater, 50)).toBeUndefined();
    expect(updateNotice({ phase: 'downloaded', version: '61' }, installLater, 50)).toBeDefined();
    expect(updateNotice(downloaded, installLater, 100)).toBeDefined();
    // An attempted install handoff keeps recovering after process death.
    expect(updateNotice(downloaded, { ...installLater, dismissal: { ...installLater.dismissal, attempted: true } }, 50)).toBeDefined();
  });
});

describe('provider update safety', () => {
  it('opens only immediate consent at a safe moment and suppresses repeat handoffs', async () => {
    const view = await provider({ nativeConsent: true, blocked: true });
    const release = view.runtime.value.block();
    view.runtime.update({ blocked: false }); await view.runtime.settle();
    expect(view.api.start).not.toHaveBeenCalled();
    release(); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
    expect(view.runtime.value.notice).toBeUndefined();
    view.foreground('background'); view.foreground('active'); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
  });
  it('rechecks safety before native consent and suppresses cancellation for the version actually offered', async () => {
    const view = await provider({ nativeConsent: true, blocked: true });
    const pending = deferred<UpdateSnapshot>();
    view.api.check = vi.fn(() => pending.promise);
    view.runtime.update({ blocked: false });
    view.runtime.update({ blocked: true });
    pending.resolve(available); await view.runtime.settle();
    expect(view.api.start).not.toHaveBeenCalled();
    view.api.check = vi.fn(async () => ({ ...available, version: '60' }));
    vi.mocked(view.api.start).mockResolvedValue(false);
    view.runtime.update({ blocked: false }); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
    expect(view.runtime.value.notice).toBeUndefined();
    expect(JSON.parse(view.storage.setItem.mock.calls.at(-1)![1]).dismissal.version).toBe('60');
    view.foreground('background'); view.foreground('active'); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
  });
  it('rechecks safety after an asynchronous read and prevents duplicate actions', async () => {
    const view = await provider(); const pending = deferred<UpdateSnapshot>();
    view.api.check = vi.fn(() => pending.promise);
    const action = view.runtime.value.update(); const duplicate = view.runtime.value.update();
    view.runtime.update({ blocked: true }); pending.resolve(available); await action; await duplicate; await view.runtime.settle();
    expect(view.api.start).not.toHaveBeenCalled();
  });
  it('recovers interrupted immediate updates inside the discovery interval', async () => {
    const view = await provider({ nativeConsent: true, stored: JSON.stringify({ lastCheckAt: Date.now(), checkPeriod: 'weekly' }), snapshot: { phase: 'inProgress', version: '59' } });
    expect(view.api.start).toHaveBeenCalledOnce();
    view.runtime.unmount(); expect(view.unsubscribe).toHaveBeenCalledOnce();
  });
  it('recovers across repeated cold starts but never repeats an in-progress handoff in one process', async () => {
    const stored = JSON.stringify({ lastCheckAt: Date.now(), checkPeriod: 'weekly', dismissal: { version: '59', phase: 'available', until: Date.now() + UPDATE_DISMISS_INTERVAL, attempted: true } });
    for (let i = 0; i < 2; i++) {
      const view = await provider({ nativeConsent: true, stored, snapshot: { phase: 'inProgress', version: 'immediate' } });
      expect(view.api.start).toHaveBeenCalledOnce();
      view.foreground('background'); view.foreground('active'); await view.runtime.settle();
      expect(view.api.start).toHaveBeenCalledOnce();
      view.runtime.unmount();
    }
    const cancelled = JSON.stringify({ lastCheckAt: Date.now(), dismissal: { version: '59', phase: 'available', until: Date.now() + UPDATE_DISMISS_INTERVAL } });
    const view = await provider({ nativeConsent: true, stored: cancelled, snapshot: { phase: 'inProgress', version: 'immediate' } });
    expect(view.api.start).not.toHaveBeenCalled();
  });
  it('holds a finished download for an explicit install instead of auto-handing off', async () => {
    const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '60' };
    const view = await provider({ nativeConsent: true, snapshot: downloaded, check: vi.fn(async () => downloaded) });
    expect(view.api.start).not.toHaveBeenCalled();
    expect(view.runtime.value.notice).toEqual(downloaded);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
  });
  it('installs a finished download without a fresh store read that can drop it', async () => {
    const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '60' };
    const check = vi.fn(async () => downloaded);
    const view = await provider({ nativeConsent: true, snapshot: downloaded, check });
    check.mockRejectedValueOnce(new Error('Play unavailable'));
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
  });
  it('keeps a finished download offered when the install handoff fails', async () => {
    const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '60' };
    const view = await provider({ nativeConsent: true, snapshot: downloaded, check: vi.fn(async () => downloaded) });
    vi.mocked(view.api.start).mockResolvedValue(false);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.runtime.value.notice).toEqual(downloaded);
    expect(JSON.parse(view.storage.setItem.mock.calls.at(-1)![1]).dismissal).toMatchObject({ version: '60', phase: 'downloaded', attempted: true });
  });
  it('suppresses a deferred install for seven days without blocking a new version', async () => {
    const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '60' };
    const view = await provider({ nativeConsent: true, snapshot: downloaded, check: vi.fn(async () => downloaded) });
    view.runtime.value.later(); await view.runtime.settle();
    expect(view.runtime.value.notice).toBeUndefined();
    expect(JSON.parse(view.storage.setItem.mock.calls.at(-1)![1]).dismissal).toMatchObject({ version: '60', phase: 'downloaded' });
  });
  it('defaults to surfacing an available update discovered inside the discovery interval', async () => {
    const view = await provider({ stored: JSON.stringify({ lastCheckAt: Date.now() }), snapshot: available });
    expect(view.runtime.value.notice).toEqual(available);
  });
  it('throttles discovery when the check period is daily or weekly', async () => {
    const view = await provider({ stored: JSON.stringify({ lastCheckAt: Date.now(), checkPeriod: 'weekly' }), snapshot: available });
    expect(view.runtime.value.notice).toBeUndefined();
  });
  it('does not offer updates when auto-update is disabled', async () => {
    const view = await provider({ stored: JSON.stringify({ lastCheckAt: 0, enabled: false }), snapshot: available });
    expect(view.runtime.value.notice).toBeUndefined();
  });
  it('persists Later and declines to prompt when storage cannot be read', async () => {
    const view = await provider(); view.runtime.value.later(); await view.runtime.settle();
    expect(view.runtime.value.notice).toBeUndefined();
    expect(JSON.parse(view.storage.setItem.mock.calls.at(-1)![1]).dismissal.version).toBe('59');
    const unread = await provider({ readError: true }); expect(unread.runtime.value.notice).toBeUndefined();
  });
  it('handles cancellation, check timeout and installation failure without repeated prompts', async () => {
    const view = await provider(); vi.mocked(view.api.start).mockResolvedValue(false);
    await view.runtime.value.update(); await view.runtime.settle(); expect(view.runtime.value.notice).toBeUndefined();
    view.event({ phase: 'failed' });
    expect(view.runtime.value.error).toBe(true); expect(view.runtime.value.notice).toBeUndefined();
    const timeout = await provider(); timeout.api.check = vi.fn(() => new Promise<UpdateSnapshot>(() => {}));
    const action = timeout.runtime.value.update(); timeout.runtime.fire(15000); await action; await timeout.runtime.settle();
    expect(timeout.runtime.value.busy).toBe(false); expect(timeout.api.start).not.toHaveBeenCalled();
  });
});

async function platform(os: string, extra: object, native = {}, globals = {}, executionEnvironment = 'standalone') {
  const resolve = vi.fn(() => native), openURL = vi.fn(async () => {});
  const module = await loadTs('shared/platform/app-updates.ts', {
    'expo-application': { applicationId: 'app.getopencode.mobile', nativeApplicationVersion: '1.0.58', getAppleStoreEnvironmentAsync: async () => (await (native as any).getAppStoreInstallation?.())?.eligible ? 'production' : 'sandbox' },
    '@/shared/platform/android-app-updates': { createAndroidAppUpdates: resolve },
    'expo-constants': { executionEnvironment, expoConfig: { ios: { bundleIdentifier: 'app.getopencode.mobile' }, extra } },
    'react-native': { Platform: { OS: os }, Linking: { openURL } },
  }, globals);
  return { ...module, resolve, openURL };
}
describe('store boundary', () => {
  it('does not resolve a native module in FOSS, Expo Go, ordinary web or iOS without an ID', async () => {
    for (const [os, extra] of [['android', { foss: true }], ['web', {}], ['ios', {}], ['android', { e2eMode: true }]]) {
      const result = await platform(os as string, { updates: { enabled: true }, ...extra as object });
      expect(result.loadAppUpdates()).toBeNull(); expect(result.resolve).not.toHaveBeenCalled();
    }
  });
  it('disables Expo Go before native resolution', async () => {
    const source = await platform('android', { updates: { enabled: true } }, {}, {}, 'storeClient');
    expect(source.loadAppUpdates()).toBeNull(); expect(source.resolve).not.toHaveBeenCalled();
  });
  it('compares Apple numeric versions and validates the App Store identity', async () => {
    const source = await platform('ios', {});
    expect(source.isNewerStoreVersion('1.10.0', '1.9')).toBe(true);
    expect(source.isNewerStoreVersion('1.2', '1.2.0')).toBe(false);
    expect(source.isNewerStoreVersion('2.0-beta', '1')).toBe(false);
    const results = [{ trackId: 123, bundleId: 'app.getopencode.mobile', version: '1.0.59' }];
    expect(source.appStoreCandidate({ results }, '123', 'app.getopencode.mobile', '1.0.58')).toEqual({ phase: 'available', version: '1.0.59' });
    expect(source.appStoreCandidate({ results }, '999', 'app.getopencode.mobile', '1.0.58').phase).toBe('none');
  });
  it('preserves StoreKit eligibility checks and opens a constructed App Store URL only on request', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [{ trackId: 123, bundleId: 'app.getopencode.mobile', version: '1.0.59', trackViewUrl: 'https://untrusted.test' }] }) }));
    const installation = vi.fn(async () => ({ eligible: false, bundleId: 'app.getopencode.mobile', installedVersion: '1.0.58' }));
    const source = await platform('ios', { updates: { enabled: true, appStoreId: '123' } }, { getAppStoreInstallation: installation }, { fetch });
    const api = source.loadAppUpdates(); expect(await api.check()).toEqual({ phase: 'none' }); expect(fetch).not.toHaveBeenCalled();
    installation.mockResolvedValue({ eligible: true, bundleId: 'app.getopencode.mobile', installedVersion: '1.0.58' });
    expect(await api.check()).toEqual({ phase: 'available', version: '1.0.59' }); expect(source.openURL).not.toHaveBeenCalled();
    await api.start(() => true); expect(source.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id123');
  });
  it('tolerates a rejecting native installation probe instead of surfacing an error', async () => {
    // Mirrors the iOS trap fix: a StoreKit failure must degrade to "no update",
    // never propagate as a rejection (which trapped Promise.swift:56 via JSI).
    const installation = vi.fn(async () => { throw new Error('StoreKit unavailable'); });
    const fetch = vi.fn();
    const source = await platform('ios', { updates: { enabled: true, appStoreId: '123' } }, { getAppStoreInstallation: installation }, { fetch });
    const api = source.loadAppUpdates();
    await expect(api.check()).resolves.toEqual({ phase: 'none' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('flexible Android adapter with explicit install', () => {
  async function adapter(info = { updateAvailable: true, immediateAllowed: true, flexibleAllowed: true, updateInProgress: false, downloaded: false, serverPriority: 0, storeVersion: '60' }) {
    const startUpdate = vi.fn(async (_immediate: boolean) => true);
    const referrer = vi.fn(async () => '');
    const remove = vi.fn();
    const create = async () => {
      const { createAndroidAppUpdates } = await loadTs('shared/platform/android-app-updates.ts', {
        'expo-application': { getInstallReferrerAsync: referrer },
        'expo-in-app-updates': { checkForUpdate: vi.fn(async () => info), startUpdate, addUpdateListener: vi.fn(() => remove) },
      });
      return createAndroidAppUpdates() as AppUpdateApi;
    };
    return { api: await create(), create, startUpdate, referrer, remove };
  }
  it('uses flexible at priorities 0-3 and immediate at 4-5', async () => {
    for (const serverPriority of [0, 3]) {
      const view = await adapter({ updateAvailable: true, immediateAllowed: true, flexibleAllowed: true, updateInProgress: false, downloaded: false, serverPriority, storeVersion: '60' });
      expect(await view.api.check()).toEqual({ phase: 'available', version: '60' });
      await view.api.start(() => true);
      expect(view.startUpdate).toHaveBeenCalledTimes(1);
      expect(view.startUpdate).toHaveBeenCalledWith(false);
    }
    for (const serverPriority of [4, 5]) {
      const forced = await adapter({ updateAvailable: true, immediateAllowed: true, flexibleAllowed: true, updateInProgress: false, downloaded: false, serverPriority, storeVersion: '60' });
      await forced.api.check();
      await forced.api.start(() => true);
      expect(forced.startUpdate).toHaveBeenCalledTimes(1);
      expect(forced.startUpdate).toHaveBeenCalledWith(true);
    }
  });
  it('only requests update types Play reports as allowed', async () => {
    const immediateOnly = await adapter({ updateAvailable: true, immediateAllowed: true, flexibleAllowed: false, updateInProgress: false, downloaded: false, serverPriority: 0, storeVersion: '60' });
    await immediateOnly.api.check();
    await immediateOnly.api.start(() => true);
    expect(immediateOnly.startUpdate).toHaveBeenCalledTimes(1);
    expect(immediateOnly.startUpdate).toHaveBeenCalledWith(true);
    const flexibleOnly = await adapter({ updateAvailable: true, immediateAllowed: false, flexibleAllowed: true, updateInProgress: false, downloaded: false, serverPriority: 5, storeVersion: '60' });
    await flexibleOnly.api.check();
    await flexibleOnly.api.start(() => true);
    expect(flexibleOnly.startUpdate).toHaveBeenCalledTimes(1);
    expect(flexibleOnly.startUpdate).toHaveBeenCalledWith(false);
    const unavailable = await adapter({ updateAvailable: true, immediateAllowed: false, flexibleAllowed: false, updateInProgress: false, downloaded: false, serverPriority: 0, storeVersion: '60' });
    expect(await unavailable.api.check()).toEqual({ phase: 'none' });
    await unavailable.api.start(() => true);
    expect(unavailable.startUpdate).not.toHaveBeenCalled();
  });
  it('falls back to immediate when Play refuses flexible and resumes an interrupted immediate flow', async () => {
    const view = await adapter();
    view.startUpdate.mockResolvedValueOnce(false);
    await view.api.check();
    await view.api.start(() => true);
    expect(view.startUpdate).toHaveBeenNthCalledWith(1, false);
    expect(view.startUpdate).toHaveBeenNthCalledWith(2, true);
    const interrupted = await adapter({ updateAvailable: true, immediateAllowed: true, flexibleAllowed: false, updateInProgress: true, downloaded: false, serverPriority: 0, storeVersion: '60' });
    expect(await interrupted.api.check()).toEqual({ phase: 'inProgress', version: '60' });
    await interrupted.api.start(() => true);
    expect(interrupted.startUpdate).toHaveBeenCalledWith(true);
  });
  it('surfaces a finished download for an explicit install and completes it on request', async () => {
    const view = await adapter({ updateAvailable: true, immediateAllowed: false, flexibleAllowed: true, updateInProgress: false, downloaded: true, serverPriority: 0, storeVersion: '60' });
    expect(await view.api.check()).toEqual({ phase: 'downloaded', version: '60' });
    await view.api.start(() => true);
    // The native DOWNLOADED branch completes the install regardless of the requested type.
    expect(view.startUpdate).toHaveBeenCalledWith(false);
  });
  it('rechecks safety before the flexible download and removes native listeners', async () => {
    const view = await adapter();
    const unsubscribe = view.api.subscribe(() => {});
    await view.api.check();
    await view.api.start(() => false);
    expect(view.startUpdate).not.toHaveBeenCalled();
    unsubscribe(); expect(view.remove).toHaveBeenCalledTimes(3);
    // The Play install was verified once; a later referrer failure must not abort the handoff.
    view.referrer.mockRejectedValue(new Error('Install referrer unavailable'));
    await view.api.check();
    await view.api.start(() => true);
    expect(view.startUpdate).toHaveBeenCalledWith(false);
  });
  it('never reaches the native module without a Play install verification', async () => {
    const view = await adapter();
    view.referrer.mockRejectedValue(new Error('Not Play installed'));
    expect(await view.api.check()).toEqual({ phase: 'none' });
    await view.api.start(() => true);
    expect(view.startUpdate).not.toHaveBeenCalled();
  });
});
