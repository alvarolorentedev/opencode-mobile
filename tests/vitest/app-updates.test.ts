import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { DEFAULT_UPDATE_CHECK_PERIOD, parseUpdatePreferences, UPDATE_CHECK_INTERVALS, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice } from '../../providers/app-update-policy';
import type { AppUpdateApi, UpdateEvent, UpdateSnapshot } from '../../lib/app-updates';

const available: UpdateSnapshot = { phase: 'available', version: '59' };
const downloaded: UpdateSnapshot = { phase: 'downloaded', version: '59' };
async function provider({ stored = null, readError = false, snapshot = available, recovery = true, nativeConsent = false, blocked = false, check = vi.fn(async () => snapshot) }:
  { stored?: string | null; readError?: boolean; snapshot?: UpdateSnapshot; recovery?: boolean; nativeConsent?: boolean; blocked?: boolean; check?: () => Promise<UpdateSnapshot> } = {}) {
  const runtime = hookRuntime();
  let event: (value: UpdateEvent) => void = () => {};
  let foreground: (value: string) => void = () => {};
  const storage = { getItem: vi.fn(async (_key: string) => { if (readError) throw Error(); return stored; }), setItem: vi.fn(async (_key: string, _value: string) => {}), removeItem: vi.fn(async (_key: string) => {}) };
  const unsubscribe = vi.fn();
  const api: AppUpdateApi = { nativeConsent, supportsRecovery: recovery, check, start: vi.fn(async () => true), complete: vi.fn(async () => {}),
    subscribe: (listener) => { event = listener; return unsubscribe; } };
  const persistence = await loadTs('providers/persistence-hydration.ts');
  const { useAppUpdates } = await loadTs('providers/use-app-updates.ts', {
    react: runtime.react, '@react-native-async-storage/async-storage': storage,
    'react-native': { AppState: { currentState: 'active', addEventListener: (_: string, listener: typeof foreground) => { foreground = listener; return { remove: vi.fn() }; } } },
    '@/lib/app-updates': { loadAppUpdates: () => api }, '@/lib/storage-keys': { APP_UPDATES_STORAGE_KEY: 'updates' },
    '@/providers/app-update-policy': { DEFAULT_UPDATE_CHECK_PERIOD, parseUpdatePreferences, UPDATE_CHECK_INTERVALS, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice },
    '@/providers/persistence-hydration': persistence,
  }, runtime.globals);
  runtime.mount(useAppUpdates, { initialized: false, blocked });
  await runtime.settle();
  expect(api.check).not.toHaveBeenCalled();
  runtime.value.setSurfaceActive(true); runtime.update({ initialized: true }); await runtime.settle();
  return { runtime, api, storage, unsubscribe, event: (value: UpdateEvent) => { event(value); runtime.flush(); }, foreground: (value: string) => { foreground(value); runtime.flush(); } };
}

describe('update policy', () => {
  it('validates persistence and resets cooldown for another version or downloaded stage', () => {
    expect(() => parseUpdatePreferences('{"lastCheckAt":"bad"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"enabled":"yes"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"checkPeriod":"monthly"}')).toThrow();
    expect(() => parseUpdatePreferences('{"lastCheckAt":0,"dismissal":{"version":"59","phase":"other","until":1}}')).toThrow();
    expect(parseUpdatePreferences('{"lastCheckAt":0}')).toEqual({ lastCheckAt: 0, enabled: true, checkPeriod: 'available' });
    const preferences = { lastCheckAt: 0, enabled: true, checkPeriod: 'available' as const, dismissal: { version: '59', phase: 'available' as const, until: 100 } };
    expect(updateNotice(available, preferences, 50)).toBeUndefined();
    expect(updateNotice(downloaded, preferences, 50)).toEqual(downloaded);
    expect(updateNotice({ ...available, version: '60' }, preferences, 50)).toBeDefined();
    expect(updateNotice(available, preferences, 100)).toBeDefined();
    expect(updateNotice({ phase: 'downloaded' }, { lastCheckAt: 0, enabled: true, checkPeriod: 'available', dismissal: { version: 'downloaded', phase: 'downloaded', until: 100 } }, 50)).toBeUndefined();
    expect(updateCheckDue(100, 99, UPDATE_CHECK_INTERVALS.daily)).toBe(true);
    expect(updateCheckDue(100, 100 + UPDATE_CHECK_INTERVALS.daily - 1, UPDATE_CHECK_INTERVALS.daily)).toBe(false);
    expect(updateCheckDue(100, 100 + UPDATE_CHECK_INTERVALS.daily, UPDATE_CHECK_INTERVALS.daily)).toBe(true);
    expect(updateCheckDue(100, 100, UPDATE_CHECK_INTERVALS.available)).toBe(true);
  });
});

describe('provider update safety', () => {
  it('opens only native consent at a safe moment and still requires an explicit restart', async () => {
    const view = await provider({ nativeConsent: true, blocked: true });
    expect(view.runtime.value.notice).toBeUndefined();
    expect(view.api.start).not.toHaveBeenCalled();
    const release = view.runtime.value.block();
    view.runtime.update({ blocked: false }); await view.runtime.settle();
    expect(view.api.start).not.toHaveBeenCalled();
    release(); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
    expect(view.runtime.value.notice).toBeUndefined();
    view.foreground('background'); view.foreground('active'); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
    view.event({ phase: 'downloaded' });
    expect(view.runtime.value.notice).toEqual(downloaded);
    expect(view.api.complete).not.toHaveBeenCalled();
    view.api.check = vi.fn(async () => downloaded);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.complete).toHaveBeenCalledOnce();
  });
  it('does not open native consent when disabled or the recovered download is ready', async () => {
    const disabled = await provider({ nativeConsent: true, stored: JSON.stringify({ lastCheckAt: 0, enabled: false }) });
    expect(disabled.api.start).not.toHaveBeenCalled();
    const ready = await provider({ nativeConsent: true, snapshot: downloaded });
    expect(ready.api.start).not.toHaveBeenCalled();
    expect(ready.api.complete).not.toHaveBeenCalled();
    expect(ready.runtime.value.notice).toEqual(downloaded);
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
  it('requires a second tap to install and blocks drafts, background and unsafe routes', async () => {
    const view = await provider();
    expect(view.runtime.value.notice).toEqual(available);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.start).toHaveBeenCalledOnce();
    view.event({ phase: 'downloaded' });
    expect(view.api.complete).not.toHaveBeenCalled();
    expect(view.runtime.value.notice).toEqual(downloaded);
    const release = view.runtime.value.block(); view.runtime.flush();
    await view.runtime.value.update(); expect(view.api.complete).not.toHaveBeenCalled();
    release(); view.runtime.flush();
    view.foreground('background'); await view.runtime.value.update(); expect(view.api.complete).not.toHaveBeenCalled();
    view.foreground('active'); await view.runtime.settle();
    view.event({ phase: 'downloaded' });
    view.runtime.value.setSurfaceActive(false); view.runtime.flush(); await view.runtime.value.update();
    expect(view.api.complete).not.toHaveBeenCalled();
    view.runtime.value.setSurfaceActive(true); view.runtime.flush();
    view.api.check = vi.fn(async () => downloaded);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.complete).toHaveBeenCalledOnce(); expect(view.runtime.value.installing).toBe(true);
    view.event({ phase: 'failed' }); expect(view.runtime.value.installing).toBe(false);
  });
  it('rechecks safety after an asynchronous read and prevents duplicate actions', async () => {
    const view = await provider(); const pending = deferred<UpdateSnapshot>();
    view.api.check = vi.fn(() => pending.promise);
    const action = view.runtime.value.update(); const duplicate = view.runtime.value.update();
    view.runtime.update({ blocked: true }); pending.resolve(available); await action; await duplicate; await view.runtime.settle();
    expect(view.api.start).not.toHaveBeenCalled();
  });
  it('turns a download discovered during an available tap into a new offer', async () => {
    const view = await provider(); view.api.check = vi.fn(async () => downloaded);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.api.complete).not.toHaveBeenCalled(); expect(view.runtime.value.notice).toEqual(downloaded);
  });
  it('recovers downloaded updates inside the persisted discovery interval without installing', async () => {
    const view = await provider({ stored: JSON.stringify({ lastCheckAt: Date.now() }), snapshot: downloaded });
    expect(view.runtime.value.notice).toEqual(downloaded); expect(view.api.complete).not.toHaveBeenCalled();
    view.runtime.unmount(); expect(view.unsubscribe).toHaveBeenCalledOnce();
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
    view.event({ phase: 'downloaded' }); vi.mocked(view.api.complete).mockRejectedValue(new Error('Failed'));
    view.api.check = vi.fn(async () => downloaded);
    await view.runtime.value.update(); await view.runtime.settle();
    expect(view.runtime.value.installing).toBe(false); expect(view.runtime.value.error).toBe(true); expect(view.runtime.value.notice).toBeUndefined();
    const timeout = await provider(); timeout.api.check = vi.fn(() => new Promise<UpdateSnapshot>(() => {}));
    const action = timeout.runtime.value.update(); timeout.runtime.fire(15000); await action; await timeout.runtime.settle();
    expect(timeout.runtime.value.busy).toBe(false); expect(timeout.api.start).not.toHaveBeenCalled();
  });
});

async function platform(os: string, extra: object, native = {}, globals = {}, executionEnvironment = 'standalone') {
  const resolve = vi.fn(() => native), openURL = vi.fn(async () => {});
  const module = await loadTs('lib/app-updates.ts', {
    expo: { requireOptionalNativeModule: resolve },
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
    await api.start(); expect(source.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id123');
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
