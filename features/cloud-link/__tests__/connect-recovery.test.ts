// @vitest-environment happy-dom

import { cloudLinkPlatform as device } from '../../../tests/helpers/cloud-link-platform';
import assert from 'node:assert/strict';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, it, onTestFinished, vi } from 'vitest';

import { useConnectState } from '@/features/cloud-link/state/connect/use-connect-machine';
import { useConnectionProfiles } from '@/features/connections/state/use-connection-profiles';
import { createConnection } from '@/runtime/connections/create-connection';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { findMatchingProfile } from '@/shared/contracts/connection-profiles';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import * as cloudLink from '@/shared/contracts/cloud-link';
import * as savedCloudLink from '@/shared/storage/cloud-link';
import * as profiles from '@/shared/storage/connection-profiles';
import { controlledClock, deferred, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const metrics = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('@/shared/observability/client', () => ({
  telemetry: { counter: (...args: unknown[]) => metrics.calls.push(args), debug() {}, info() {}, warn() {}, markStartup() {} },
  withSpan: async (_name: string, _attrs: unknown, run: (span: { setAttribute: () => void }) => Promise<unknown>) =>
    run({ setAttribute() {} }),
}));

const connect = { ...cloudLink, ...savedCloudLink };
const CP = 'https://api.opencodecloud.link';
type Barrier = ReturnType<typeof deferred<void>>;

async function invoke<T>(action: () => T | Promise<T>) {
  let result!: T;
  await act(async () => { result = await action(); });
  return result;
}
function start<T>(action: () => Promise<T>) {
  let pending!: Promise<T>;
  act(() => { pending = action(); });
  return pending;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('connect recovery', () => {
  it('connect recovery', async () => {

async function fixture({ expired = false, missing = false, storedSession = true, storeGate, ttl = 600000, unchangedExpiry = false, denyAccess = 0, activation: initialActivation, accessActivation }: { expired?: boolean; missing?: boolean; storedSession?: boolean; storeGate?: Barrier; ttl?: number; unchangedExpiry?: boolean; denyAccess?: number; activation?: cloudLink.ConnectActivation; accessActivation?: cloudLink.ConnectActivation } = {}) {
  let now = Date.now(), accessCalls = 0, pairClaims = 0, claims = 0, catalogs = 0, resets = 0, secretWrites = 0, activationCalls = 0, accessFailure = false, catalogFailure: string | boolean = false, accessDenials = denyAccess, accessGate: Barrier | undefined;
  let activation = initialActivation;
  const listeners = new Set<(state: string) => void>();
  const timers = controlledClock(now);
  const deadlines = new Map<ReturnType<typeof setTimeout>, number>();
  const connectionClock = {
    now: () => now,
    random: () => 0,
    setTimeout(callback: () => void, delay: number) {
      const timer = setTimeout(() => { deadlines.delete(timer); callback(); }, delay);
      deadlines.set(timer, delay);
      return timer;
    },
    clearTimeout(timer?: ReturnType<typeof setTimeout>) {
      if (timer !== undefined) deadlines.delete(timer);
      clearTimeout(timer);
    },
  };
  const countTimers = (delay: number) => [...deadlines.values()].filter((value) => value === delay).length;
  const date = vi.spyOn(Date, 'now').mockImplementation(() => now);
  metrics.calls = [];
  const contractMetrics = metrics.calls;
  device.config = { extra: {}, android: { package: 'app.getopencode' } };
  device.os = 'android';
  device.state = 'active';
  device.preferences.clear();
  device.secrets.clear();
  device.onSecretWrite = () => { secretWrites++; };
  device.appState = (listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const session = { user_id: 'owner', user_token: 'user-token', session_expires_at: new Date(now + 86400000).toISOString(), subscription_expires_at: new Date(now + 3600000).toISOString(), entitlements: ['cloudlink'] };
  const claim = { server_url: 'https://machine.test', machine_id: 'machine-a', machine_name: 'Mac', device_id: 'device-a', device_secret: 'secret-a', expires_at: new Date(now + (expired ? -1000 : ttl)).toISOString() };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const address = new URL(url);
    if (address.origin !== CP) {
      if (address.pathname === '/api/info') return Response.json({ version: '2.0.0-fixture', pid: 1 });
      if (address.pathname === '/api/location') return Response.json({ directory: '/fixture', project: { id: 'p', directory: '/fixture', canonical: '/fixture' } });
      if (address.pathname === '/api/project') {
        catalogs++;
        if (catalogFailure && address.hostname === 'machine.test') {
          if (typeof catalogFailure === 'string') return new Response(catalogFailure, { status: 530, headers: { 'content-type': 'text/html' } });
          return Response.json({ error: 'Network offline' }, { status: 400 });
        }
        return Response.json([]);
      }
      if (address.pathname === '/api/event') {
        const signal = options?.signal ?? (input instanceof Request ? input.signal : undefined);
        const body = new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => { try { controller.close(); } catch { /* Already canceled. */ } }, { once: true });
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(null, { status: 404 });
    }
  let body;
  if (url.endsWith('/catalog')) body = { plans: [{ id: 'cloudlink', entitlements: ['cloudlink'], products: [{ store: 'google', productId: 'fixture', basePlanId: 'monthly', offerIds: [] }] }] };
  else if (url.endsWith('/subscriptions/claim')) { claims++; body = session; }
  else if (/\/v1\/(?:pairings|machines)\/[^/]+\/activation$/.test(url)) { activationCalls++; body = activation ?? { state: 'ready' }; }
  else if (/\/pairings\/[^/]+\/claim$/.test(url)) { pairClaims++; body = { ...claim, ...(activation ? { activation } : {}) }; }
  else if (url.endsWith('/access')) {
    accessCalls++;
    await accessGate?.promise;
    if (accessFailure) return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
    if (accessDenials > 0) { accessDenials--; return new Response(JSON.stringify({ error: 'no active subscription' }), { status: 403 }); }
    body = { ...claim, device_id: `device-${accessCalls}`, device_secret: `secret-${accessCalls}`, expires_at: unchangedExpiry ? claim.expires_at : new Date(now + 3600000).toISOString(), ...(accessActivation ? { activation: accessActivation } : {}) };
  } else body = { machines: [{ id: claim.machine_id, name: 'Mac', hostname: 'machine.test', public_url: claim.server_url, created_at: new Date(now).toISOString(), access_enabled: true }] };
  return Response.json(body);
  });
  const profile = await profiles.saveConnectProfile(CP, claim);
  if (missing) await profiles.deleteProfilePassword(profile.id);
  if (storedSession) await connect.saveConnectSession(CP, 'google', session);
  device.billing = {
    initConnection: async () => { await storeGate?.promise; return true; },
    endConnection: async () => true,
    restorePurchases: async () => {},
    fetchProducts: async () => [{ id: 'fixture', platform: 'android', type: 'subs', title: 'Monthly', displayPrice: '$5',
      subscriptionOffers: [{ id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-offer', displayPrice: '$5', price: 5 }] }],
    getAvailablePurchases: async () => [{ id: 'renewal', store: 'google', productId: 'fixture', purchaseState: 'purchased',
      purchaseToken: 'proof', transactionDate: now, isAcknowledgedAndroid: true }],
    getPendingTransactionsIOS: async () => [],
    finishTransaction: async () => {},
    purchaseUpdatedListener: () => ({ remove() {} }),
    purchaseErrorListener: () => ({ remove() {} }),
  };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  focusManager.setFocused(true);
  const manager = createConnection({
    queryClient: cache, clock: connectionClock,
    foreground: {
      isActive: () => device.state === 'active',
      subscribe: (listener) => {
        const receive = (state: string) => listener(state === 'active');
        listeners.add(receive);
        return () => { listeners.delete(receive); };
      },
    },
  });
  const runtime = renderHook(() => {
    const [settings, setSettings] = useState<OpencodeConnectionSettings>({ serverUrl: profile.serverUrl, username: profile.username, password: missing ? '' : claim.device_secret, directory: '', connect: profile.connect });
    const [activeProjectPath] = useState('/fixture');
    const [controlPlaneUrl, setControlPlaneUrl] = useState(CP);
    const [savedProfiles, setProfiles] = useState<ConnectionProfile[]>([]);
    const revision = useRef(0);
    const activeSettings = useRef(settings);
    useLayoutEffect(() => { activeSettings.current = settings; });
    const changeSettings = useCallback((_id: string, next: OpencodeConnectionSettings) => { revision.current++; setSettings(next); }, []);
    const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
      revision.current++; setSettings((current) => ({ ...current, ...patch }));
    }, []);
    const switchConnection = useCallback<Parameters<typeof useConnectState>[0]['switchConnection']>(async (next) => {
      flushSync(() => changeSettings('', { ...next, directory: '' }));
      return manager.connect();
    }, [changeSettings]);
    const disconnect = useCallback(async () => updateSettings({ serverUrl: '', username: '', password: '', connect: undefined }), [updateSettings]);
    const isActiveProfile = useCallback((candidate: ConnectionProfile) =>
      Boolean(activeSettings.current.connect && findMatchingProfile([candidate], activeSettings.current)), []);
    const connectSetup = useConnectState({
      profiles: savedProfiles, setProfiles, controlPlaneUrl, setControlPlaneUrl, switchConnection, disconnect, isHydrated: true,
      migrateConnectConnectionScope: async () => {},
      activeMachineId: settings.connect?.machineId, beforeProfileRefresh: async () => {}, onProfileRefreshed: () => {}, isActiveProfile,
    });
    const state = useSyncExternalStore(manager.subscribe, manager.getState);
    const id = getConnectionUiScope(settings);
    useLayoutEffect(() => manager.setInput({
      entry: { id, name: profile.name, settings, enabled: true, revision: revision.current, projects: ['/fixture'], preferences: {} },
      identity: { connectionId: id, connectionScope: getConnectionScope(settings), authRevision: 0 },
      setup: connectSetup, translate: (key) => key, hydrated: true, updateSettings: changeSettings,
    }));
    useEffect(() => manager.syncConnection(), [id, settings]);
    const renewalPaused = connectSetup.phase === 'waitingForApproval' || connectSetup.phase === 'delayed';
    useEffect(() => manager.syncRenewal(), [id, settings.connect, settings.password, renewalPaused]);
    useLayoutEffect(() => manager.onInvalidated(() => { resets++; }), []);
    const connectionProfiles = useConnectionProfiles({ clearCapabilitiesSnapshots: async () => {}, settings, switchConnection, updateSettings, profiles: savedProfiles, setProfiles });
    return { connection: state.connection, connect: manager.connect, handleStreamAuthFailure: manager.handleStreamAuthFailure,
      connectSetup, updateSettings, settings, activeProjectPath, connectionProfiles };
  }, undefined, ({ children }) => createElement(QueryClientProvider, { client: cache }, children));
  let mounted = true;
  function unmount() {
    if (!mounted) return;
    mounted = false;
    runtime.unmount();
    manager.dispose();
    cache.clear();
    focusManager.setFocused(undefined);
    date.mockRestore();
    timers.restore();
  }
  onTestFinished(unmount);
  return {
    runtime: { ...runtime, unmount },
    clock: { advance: timers.advance, countTimers }, connect, profile, profiles, contractMetrics,
    get accesses() { return accessCalls; }, get pairClaims() { return pairClaims; }, get claims() { return claims; },
    get catalogs() { return catalogs; }, get resets() { return resets; }, get activations() { return activationCalls; },
    get secretWrites() { return secretWrites; },
    extendEntitlement(ms: number) {
      session.subscription_expires_at = new Date(Date.parse(session.subscription_expires_at) + ms).toISOString();
      return session.subscription_expires_at;
    },
    setActivation(value: any) { activation = value; },
    failAccess(value: any) { accessFailure = value; }, setAccessDenials(value: number) { accessDenials = value; }, failCatalog(value: any) { catalogFailure = value; }, blockAccess() { accessGate = deferred<void>(); return accessGate; },
    advance(ms: number) { now += ms; },
    appState(state: string) {
      device.state = state;
      act(() => {
        focusManager.setFocused(state === 'active');
        for (const listener of listeners) listener(state);
      });
    },
  };
}

// A healthy reopen neither rotates credentials nor manufactures an unsaved row.
{
  const f = await fixture(); await settleReact();
  await invoke(() => f.runtime.result.current.connect()); await settleReact();
  f.appState('background'); f.advance(1000); f.appState('active'); await settleReact();
  assert.equal(f.accesses, 0);
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.connectionProfiles.profiles.length, 1);
  assert.equal(f.contractMetrics.length, 1);
  assert.equal(f.contractMetrics[0][0], 'server.contract');
  assert.equal(f.contractMetrics[0][1], 1);
  assert.equal((f.contractMetrics[0][2] as { contract: string }).contract, 'v2');
  f.runtime.unmount();
}
// Returning after a network error reconnects without rotating valid credentials.
{
  const f = await fixture(); await settleReact(); f.failCatalog(true);
  await invoke(() => f.runtime.result.current.connect()); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'error');
  f.appState('background'); f.failCatalog(false); f.appState('active');
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.accesses, 0, 'An offline connection reuses valid credentials on foreground return.');
  f.runtime.unmount();
}
// An unchanged paid-through date does not create a recurring rotation loop.
{
  const f = await fixture({ ttl: 120000, unchangedExpiry: true }); await settleReact();
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.accesses, 1);
  f.appState('background'); f.advance(1000); f.appState('active'); await settleReact();
  await invoke(() => f.runtime.result.current.connect()); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.clock.countTimers(1000), 0);
  f.advance(119000); await f.clock.advance(119000); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'error', 'Foreground expiry still blocks old credentials.');
  assert.equal(f.clock.countTimers(1000), 1, 'Foreground expiry schedules recovery even after an unchanged paid-through refresh.');
  f.runtime.unmount();
}
// A renewal 403 before expiry keeps the still-valid credential and entitlement.
{
  const f = await fixture({ ttl: 120000, denyAccess: 10 }); await settleReact();
  await f.clock.advance(1000); await settleReact();
  assert.ok(f.accesses >= 1, 'The pre-expiry refresh must run.');
  assert.equal(f.claims, 0, 'A proactive 403 must not clear entitlement or claim the store.');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.settings.password, 'secret-a', 'The still-valid credential is retained.');
  assert.equal(f.connect.hasConnectEntitlement(await f.connect.getConnectSession(CP, 'google')), true);
  f.runtime.unmount();
}
// A transient renewal failure before expiry keeps the still-valid credential.
{
  const f = await fixture({ ttl: 360000 }); await settleReact();
  assert.equal(f.accesses, 0, 'A credential outside the renewal window is not refreshed.');
  f.failAccess(true);
  f.advance(120000);
  await invoke(() => f.runtime.result.current.connect()); await settleReact();
  assert.equal(f.accesses, 1, 'The pre-expiry refresh must run.');
  assert.equal(f.claims, 0, 'A transient control-plane failure must not verify the store again.');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.settings.password, 'secret-a', 'The still-valid credential is retained.');
  f.runtime.unmount();
}
// Once the credential expires, a rejected access still recovers through the store.
{
  const f = await fixture({ ttl: 120000, denyAccess: 10 }); await settleReact();
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.claims, 0);
  f.setAccessDenials(1); f.advance(120000); await f.clock.advance(120000); await settleReact();
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.claims, 1, 'Expiry recovery still verifies the native purchase.');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  f.runtime.unmount();
}
// Credentials longer than a setTimeout wake once to re-arm the remaining lifetime.
{
  const max = 2_147_483_647;
  const f = await fixture({ ttl: 90 * 86400000 }); await settleReact();
  assert.equal(f.clock.countTimers(max), 2, 'Expiry and refresh timers are capped.');
  f.advance(max); await f.clock.advance(max); await settleReact();
  assert.equal(f.accesses, 0, 'The capped wake-up is not a credential refresh.');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.clock.countTimers(max), 2, 'The refresh timer re-arms for the remaining lifetime.');
  f.runtime.unmount();
}
// Failed native initialization surfaces an error without sending expired auth.
{
  const gate = deferred<void>();
  const f = await fixture({ expired: true, storedSession: false, storeGate: gate });
  const boot = start(() => f.runtime.result.current.connect()); await settleReact();
  await invoke(() => gate.reject(new Error('native store unavailable'))); await boot;
  assert.equal(f.accesses, 0); assert.equal(f.catalogs, 0);
  assert.equal(f.runtime.result.current.connection.status, 'error');
  f.runtime.unmount();
}
// Automatic retry recovers after the existing 60-second delay.
{
  const f = await fixture({ expired: true }); await settleReact(); f.failAccess(true);
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.clock.countTimers(60000), 1);
  f.failAccess(false); f.advance(60000); await f.clock.advance(60000); await f.clock.advance(1000); await settleReact();
  assert.equal(f.accesses, 2); assert.equal(f.runtime.result.current.connection.status, 'connected');
  f.runtime.unmount();
}
// Already-expired credentials returned by the backend remain blocked and back off.
{
  const f = await fixture({ expired: true, unchangedExpiry: true }); await settleReact();
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.catalogs, 0);
  assert.equal(f.clock.countTimers(1000), 0); assert.equal(f.clock.countTimers(60000), 1);
  f.runtime.unmount();
}
// Resume past expiry recovers automatically and retries failures only while active.
{
  const f = await fixture(); await settleReact(); await invoke(() => f.runtime.result.current.connect());
  f.appState('background'); f.advance(660000); f.failAccess(true); f.appState('active');
  assert.equal(f.runtime.result.current.connection.status, 'error');
  assert.equal(f.clock.countTimers(1000), 1);
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.result.current.connection.status, 'error');
  assert.equal(f.clock.countTimers(60000), 1);
  f.appState('background'); assert.equal(f.clock.countTimers(60000), 0);
  f.failAccess(false); f.appState('active'); await f.clock.advance(1000); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.connectSetup.phase, 'idle', 'Automatic recovery releases the secure-save phase.');
  assert.equal(f.runtime.result.current.activeProjectPath, '/fixture');
  assert.equal(f.runtime.result.current.connectionProfiles.profiles[0].username, f.runtime.result.current.settings.username);
  f.runtime.unmount();
}
// Cold launch waits for native-store recovery and shares access with initialization.
{
  const gate = deferred<void>();
  const f = await fixture({ expired: true, storedSession: false, storeGate: gate });
  const boot = start(() => f.runtime.result.current.connect()); await settleReact();
  assert.equal(f.accesses, 0); assert.equal(f.catalogs, 0);
  await invoke(() => gate.resolve()); await settleReact(); await boot; await settleReact();
  assert.equal(f.accesses, 1);
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.activeProjectPath, '/fixture');
  assert.equal(f.runtime.result.current.connectSetup.error, undefined);
  assert.equal(f.runtime.result.current.connectSetup.initialization, 'ready');
  f.runtime.unmount();
}
// Simultaneous manual/automatic preparation gets one rotated credential pair.
{
  const f = await fixture({ missing: true }); await settleReact();
  const gate = f.blockAccess();
  const first = start(() => f.runtime.result.current.connect()), second = start(() => f.runtime.result.current.connect());
  await settleReact(); assert.equal(f.accesses, 1);
  assert.equal(f.runtime.result.current.connectSetup.selectControlPlane('https://apistaging.opencodecloud.link'), false, 'An access request must retain its authenticated environment.');
  await invoke(() => gate.resolve()); await Promise.all([first, second]); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.resets, 1, 'only the expiry reset clears state');
  assert.equal(f.runtime.result.current.activeProjectPath, '/fixture', 'a same-machine credential rotation keeps the workspace identity');
  assert.equal(f.catalogs, 1, 'concurrent connects share one project discovery');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.runtime.result.current.activeProjectPath, '/fixture', 'a same-machine rotation keeps the selected project');
  f.runtime.unmount();
}
// A request finishing after backgrounding must not rearm a retry timer.
{
  const f = await fixture({ expired: true }); await settleReact();
  const gate = f.blockAccess(); f.failAccess(true);
  await f.clock.advance(1000); await settleReact();
  f.appState('background'); await invoke(() => gate.resolve()); await settleReact();
  assert.equal(f.clock.countTimers(60000), 0);
  f.runtime.unmount();
}
// Switching machines during recovery must discard both success and failure.
for (const [fail, cloud] of [[false, false], [true, false], [false, true], [true, true]]) {
  const f = await fixture({ expired: true }); await settleReact();
  const gate = f.blockAccess();
  const recovery = start(() => f.runtime.result.current.connect()); await settleReact();
  const next = cloud ? await f.profiles.saveConnectProfile(CP, { server_url: 'https://other.test', machine_id: 'machine-b', machine_name: 'Other', device_id: 'device-b', device_secret: 'secret-b', expires_at: new Date(Date.now() + 3600000).toISOString() }) : undefined;
  const serverUrl = next?.serverUrl ?? 'https://manual.test';
  act(() => f.runtime.result.current.updateSettings({ serverUrl, username: next?.username ?? 'manual', password: cloud ? 'secret-b' : '', connect: next?.connect }));
  await settleReact(); await invoke(() => f.runtime.result.current.connect()); await settleReact();
  f.failAccess(fail); await invoke(() => gate.resolve()); await recovery; await settleReact();
  assert.equal(f.runtime.result.current.settings.serverUrl, serverUrl);
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  f.runtime.unmount();
}
// Renewal while mounted refreshes the same profile and keeps the project.
{
  const f = await fixture(); await settleReact(); await invoke(() => f.runtime.result.current.connect());
  const extendedExpiry = f.extendEntitlement(3_600_000);
  assert.equal(await invoke(() => f.runtime.result.current.connectSetup.restore()), true); await settleReact();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.result.current.activeProjectPath, '/fixture');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  const setup = f.runtime.result.current.connectSetup;
  assert.equal(setup.subscriptionExpiresAt, extendedExpiry);
  assert.equal(setup.phase, 'paired');
  assert.equal(setup.busy, false);
  assert.equal(setup.initialization, 'ready');
  assert.equal(setup.storeReady, true);
  const saved = f.runtime.result.current.connectionProfiles.profiles;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, f.profile.id);
  assert.equal(saved[0].username, f.runtime.result.current.settings.username);
  f.runtime.unmount();
}
// Renewing an inactive Cloud Link also updates the mounted connection list.
{
  const f = await fixture(); await settleReact();
  act(() => f.runtime.result.current.updateSettings({ serverUrl: 'https://manual.test', username: 'manual', password: '', connect: undefined }));
  await settleReact();
  assert.equal(await invoke(() => f.runtime.result.current.connectSetup.restore()), true); await settleReact();
  assert.equal(f.runtime.result.current.settings.serverUrl, 'https://manual.test');
  const stored = await f.profiles.loadConnectionProfiles();
  assert.equal(f.runtime.result.current.connectionProfiles.profiles[0].username, stored[0].username);
  assert.notEqual(stored[0].username, f.profile.username);
  f.runtime.unmount();
}

// First-claim approval waiting owns recovery, including after an overdue resume.
const approvalQR = 'opencodemobile://pair?v=1&cp=https%3A%2F%2Fapi.opencodecloud.link&id=approval&t=one-use-token&n=Mac';
{
  const f = await fixture(); await settleReact(); f.failCatalog('Cloudflare Error 1033');
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  await f.clock.advance(500); // Settle the data-plane retry before the startup delay.
  await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForApproval');
  assert.equal(f.pairClaims, 1); assert.equal(f.accesses, 0);
  assert.equal(f.clock.countTimers(1000), 0, 'Foreground recovery must not compete with activation.');
  f.appState('background'); f.advance(3000); await f.clock.advance(3000); await settleReact();
  const before = f.catalogs;
  f.advance(180000); f.appState('active'); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'delayed');
  assert.equal(f.runtime.result.current.connectSetup.error, undefined);
  assert.equal(f.runtime.result.current.connectSetup.canRetry, true);
  assert.equal(f.catalogs, before, 'Overdue foreground return does not reconnect or restart the budget.');
  assert.equal(f.clock.countTimers(1000), 0);
  f.appState('background'); f.appState('active'); await settleReact();
  assert.equal(f.catalogs, before);
  f.failCatalog(false);
  await invoke(() => f.runtime.result.current.connectSetup.retry()); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'paired');
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  assert.equal(f.pairClaims, 1, 'Retry must not replay the QR claim.');
  assert.equal(f.accesses, 0, 'Retry must not rotate credentials or refresh machine access.');
  assert.equal(f.runtime.result.current.settings.password, 'secret-a');
  f.runtime.unmount();
}
// Rescan retires only the activation checkpoint and accepts the connector's new QR.
{
  const f = await fixture(); await settleReact(); f.failCatalog('Cloudflare Error 1033');
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  await f.clock.advance(500); // Settle the data-plane retry before the startup delay.
  await settleReact();
  f.advance(120000); await f.clock.advance(3000); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'delayed');
  await invoke(() => f.runtime.result.current.connectSetup.cancelPairing()); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'idle');
  assert.equal((await f.profiles.loadConnectionProfiles()).length, 1);
  assert.equal(await f.profiles.getProfilePassword(f.profile.id), 'secret-a');
  f.failCatalog(false);
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR.replace('id=approval', 'id=new-approval'))); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'paired'); assert.equal(f.pairClaims, 2);
  f.runtime.unmount();
}

// A still-valid post-claim credential is not rotated after a minute of waiting.
{
  const f = await fixture({ ttl: 240000 }); await settleReact(); f.failCatalog('Cloudflare Error 1033');
  const beforeAccess = f.accesses;
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  await f.clock.advance(500); // Settle the data-plane retry before the startup delay.
  await settleReact();
  f.advance(63000); await f.clock.advance(3000); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForApproval');
  assert.equal(f.accesses, beforeAccess, 'Near-expiry preparation must reuse valid activation credentials.');
  f.runtime.unmount();
}
// A connection selected during the wait cannot be replaced by the old activation.
{
  const f = await fixture(); await settleReact(); f.failCatalog('Cloudflare Error 1033');
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  await f.clock.advance(500); // Settle the data-plane retry before the startup delay.
  await settleReact();
  const before = f.catalogs;
  act(() => f.runtime.result.current.updateSettings({ serverUrl: 'http://manual.test', username: '', password: '', connect: undefined }));
  await settleReact(); f.advance(3000); await f.clock.advance(3000); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'idle');
  assert.equal(f.runtime.result.current.settings.serverUrl, 'http://manual.test');
  assert.equal(f.catalogs, before + 1, 'Only the new connection probes; stale activation cannot switch back.');
  f.runtime.unmount();
}

// Claim activation polls read-only and never rotates the saved credential.
{
  const activation: cloudLink.ConnectActivation = { state: 'pending_approval', retry_after_ms: 1000, expires_at: new Date(Date.now() + 60000).toISOString() };
  const f = await fixture({ activation }); await settleReact();
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForApproval');
  assert.equal(f.pairClaims, 1); assert.equal(f.accesses, 0);
  assert.ok(f.activations > 0, 'The read-only activation endpoint must be polled.');
  const writes = f.secretWrites;
  f.setActivation({ state: 'ready' });
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'paired');
  assert.equal(f.accesses, 0, 'Activation polling must not call access.');
  assert.equal(f.secretWrites, writes, 'Activation polling must not write credentials.');
  assert.equal(f.runtime.result.current.settings.password, 'secret-a');
  f.runtime.unmount();
}
// Tunnel startup has its own waiting phase and also waits for readiness.
{
  const activation: cloudLink.ConnectActivation = { state: 'tunnel_starting', retry_after_ms: 1000, expires_at: new Date(Date.now() + 60000).toISOString() };
  const f = await fixture({ activation }); await settleReact();
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForTunnel');
  assert.equal(f.accesses, 0);
  f.setActivation({ state: 'ready' });
  await f.clock.advance(1000); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'paired');
  assert.equal(f.accesses, 0);
  f.runtime.unmount();
}

// Selecting another Cloud Link machine cancels a server activation wait.
{
  const f = await fixture({ activation: { state: 'pending_approval', retry_after_ms: 1000 } });
  await settleReact();
  await invoke(() => f.runtime.result.current.connectSetup.pairLink(approvalQR)); await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForApproval');
  const other = await f.profiles.saveConnectProfile(CP, { server_url: 'https://other.test', machine_id: 'machine-b', machine_name: 'Other', device_id: 'device-b', device_secret: 'secret-b', expires_at: new Date(Date.now() + 3600000).toISOString() });
  act(() => f.runtime.result.current.updateSettings({ serverUrl: other.serverUrl, username: other.username, password: 'secret-b', connect: other.connect }));
  await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'idle');
  assert.equal(f.runtime.result.current.connectSetup.busy, false);
  f.runtime.unmount();
}

// Machine access activation is honored without polling access again.
{
  const f = await fixture({ activation: { state: 'tunnel_starting', retry_after_ms: 1000 }, accessActivation: { state: 'tunnel_starting', retry_after_ms: 1000 } });
  await settleReact();
  const connecting = start(() => f.runtime.result.current.connectSetup.connectMachine('machine-a'));
  await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'waitingForTunnel');
  assert.equal(f.accesses, 1);
  f.setActivation({ state: 'ready' });
  await f.clock.advance(1000); await settleReact();
  await connecting; await settleReact();
  assert.equal(f.runtime.result.current.connectSetup.phase, 'paired');
  assert.equal(f.accesses, 1, 'Readiness polling must not repeat access.');
  f.runtime.unmount();
}

// Data-plane revocation stops automatic retries and surfaces an actionable state.
{
  const f = await fixture(); await settleReact();
  act(() => f.runtime.result.current.updateSettings({ serverUrl: 'http://manual.test', username: '', password: '', connect: undefined })); await settleReact();
  await invoke(() => f.runtime.result.current.connect()); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  const before = f.resets;
  act(() => f.runtime.result.current.handleStreamAuthFailure('auth')); await settleReact();
  assert.equal(f.runtime.result.current.connection.status, 'error');
  assert.equal(f.runtime.result.current.connection.kind, 'auth');
  assert.equal(f.resets, before + 1, 'revocation clears server-derived caches once');
  act(() => f.runtime.result.current.handleStreamAuthFailure('auth')); await settleReact();
  assert.equal(f.resets, before + 1, 'a repeated failure is not cleared twice');
  f.runtime.unmount();
}
// Cloud Link revocation reuses the prepared credential recovery path.
{
  const f = await fixture({ expired: true }); await settleReact();
  act(() => f.runtime.result.current.handleStreamAuthFailure('entitlement')); await settleReact();
  assert.equal(f.accesses, 1);
  assert.equal(f.runtime.result.current.connection.status, 'connected');
  f.runtime.unmount();
}

  }, 120_000);
});
