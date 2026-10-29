import assert from 'node:assert/strict';
import { base64 } from '@scure/base';
import { z } from 'zod';
import { loadTs, hookRuntime, deferred, type Deferred } from '../helpers/runtime.mjs';
import { describe, it } from 'vitest';

describe('connect recovery', () => {
  it('connect recovery', async () => {

const CP = 'https://api.opencodecloud.link';
const ref = (current: any) => ({ current });
const noop = () => {};
async function fixture({ expired = false, missing = false, storedSession = true, storeGate, ttl = 600000, unchangedExpiry = false }: { expired?: boolean; missing?: boolean; storedSession?: boolean; storeGate?: Deferred<void>; ttl?: number; unchangedExpiry?: boolean } = {}) {
  const runtime = hookRuntime();
  let now = Date.now(), accessCalls = 0, pairClaims = 0, catalogs = 0, resets = 0, softResets = 0, accessFailure = false, catalogFailure = false, accessGate: Deferred<void> | undefined;
  const globals = { ...runtime.globals, Date: class extends Date { static now() { return now; } } };
  const storage = new Map(), secrets = new Map(), listeners = new Set();
  const native = {
    Platform: { OS: 'android' },
    AppState: { currentState: 'active', addEventListener(_: any, listener: any) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
  };
  const asyncStorage = { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); }, removeItem: async (key: string) => { storage.delete(key); } };
  const secureStore = { getItemAsync: async (key: string) => secrets.get(key) ?? null, setItemAsync: async (key: string, value: string) => { secrets.set(key, value); }, deleteItemAsync: async (key: string) => { secrets.delete(key); } };
  const session = { user_id: 'owner', user_token: 'user-token', session_expires_at: new Date(now + 86400000).toISOString(), subscription_expires_at: new Date(now + 3600000).toISOString(), entitlements: ['cloudlink'] };
  const claim = { server_url: 'https://machine.test', machine_id: 'machine-a', machine_name: 'Mac', device_id: 'device-a', device_secret: 'secret-a', expires_at: new Date(now + (expired ? -1000 : ttl)).toISOString() };
  const connect = await loadTs('lib/connect.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: {} } } },
    'expo-secure-store': secureStore,
    'react-native': native,
    'expo/fetch': { fetch: async (url: string) => {
      let body;
      if (url.endsWith('/catalog')) body = { plans: [{ id: 'cloudlink', entitlements: ['cloudlink'], products: [{ store: 'google', productId: 'fixture', basePlanId: 'monthly', offerIds: [] }] }] };
      else if (url.endsWith('/subscriptions/claim')) body = session;
      else if (/\/pairings\/[^/]+\/claim$/.test(url)) { pairClaims++; body = claim; }
      else if (url.endsWith('/access')) {
        accessCalls++;
        await accessGate?.promise;
        if (accessFailure) return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
        body = { ...claim, device_id: `device-${accessCalls}`, device_secret: `secret-${accessCalls}`, expires_at: unchangedExpiry ? claim.expires_at : new Date(now + 3600000).toISOString() };
      } else body = { machines: [{ id: claim.machine_id, name: 'Mac', hostname: 'machine.test', public_url: claim.server_url, created_at: new Date(now).toISOString(), access_enabled: true }] };
      return new Response(JSON.stringify(body));
    } },
  }, globals);
  const keys = await loadTs('lib/storage-keys.ts');
  const scope = await loadTs('lib/connection-scope.ts', { '@scure/base': { base64 } });
  const profiles = await loadTs('lib/connection-profiles.ts', {
    '@/providers/workspace-storage': { WORKSPACES_STORAGE_KEY: 'opencode-mobile.workspaces', parseWorkspaces: JSON.parse },
    '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage }, 'expo-secure-store': secureStore,
    'expo-crypto': { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
    'react-native': native, '@/lib/connect': connect, '@/lib/connection-scope': scope,
    '@/lib/connection-password': { getConnectionPassword: async () => '' }, '@/lib/storage-keys': keys,
    '@/lib/connection-headers': { getProfileHeaders: async () => ({}), getConnectionHeaders: async () => ({}) },
    '@/lib/auto-model/preferences': { normalizeAutoModelPreferences: (value: unknown) => value },
    '@/lib/opencode/client/url': await loadTs('lib/opencode/client/url.ts', { './types': { defaultConnectionSettings: { serverUrl: 'http://localhost' } } }),
    zod: { z },
  }, globals);
  const profile = await profiles.saveConnectProfile(CP, claim);
  if (missing) await profiles.deleteProfilePassword(profile.id);
  if (storedSession) await connect.saveConnectSession(CP, 'google', session);
  const purchase = { id: 'renewal', store: 'google', productId: 'fixture', purchaseState: 'purchased', purchaseToken: 'proof', transactionDate: now, isAcknowledgedAndroid: true };
  const api = {
    initConnection: async () => true, endConnection: async () => {}, restorePurchases: async () => {}, fetchProducts: async () => [{}],
    getAvailablePurchases: async () => [purchase], getPendingTransactionsIOS: async () => [], finishTransaction: async () => {},
    purchaseUpdatedListener: () => ({ remove: noop }), purchaseErrorListener: () => ({ remove: noop }),
  };
  const store = { loadConnectStore: async () => { await storeGate?.promise; return api; },
    isConnectPurchase: () => true, selectConnectOffers: () => [{ key: 'monthly' }],
    connectPurchaseProof: async () => ({ store: 'google', purchaseToken: 'proof' }),
  };
  const imports: Record<string, any> = { react: runtime.react, 'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) }, 'react-native': native, '@/lib/connect': connect,
    '@/lib/connect-install': { isConnectStoreInstall: async () => true },
    '@/lib/connect-store': store, '@/lib/connection-profiles': profiles, '@/lib/connection-scope': scope,
    '@/providers/connection-refresh': { migrateConnectConnectionScope: async () => {} },
  };
  const subscription = await loadTs('providers/services/connect-subscription-service.ts', imports, globals);
  imports['@/providers/services/connect-subscription-service'] = subscription;
  imports['@/providers/connect/catalog'] = await loadTs('providers/connect/catalog.ts', imports, globals);
  imports['@/providers/connect/purchases'] = await loadTs('providers/connect/purchases.ts', imports, globals);
  imports['@/providers/connect/pairing'] = await loadTs('providers/connect/pairing.ts', imports, globals);
  imports['./activation'] = await loadTs('providers/connect/activation.ts', imports, globals);
  imports['@/providers/connect/access'] = await loadTs('providers/connect/access.ts', imports, globals);
  const setup = await loadTs('providers/connect/use-connect-machine.ts', imports, globals);
  imports['@/providers/use-connect-state'] = setup;
  imports['@/lib/connection-password'] = { saveConnectionPassword: async () => {} };
  imports['@/lib/connection-headers'] = {
    getProfileHeaders: async () => ({}), saveProfileHeaders: async () => {}, deleteProfileHeaders: async () => {},
    connectionHeadersKey: (headers: any) => JSON.stringify(Object.entries(headers ?? {})),
    sameConnectionHeaders: (left: any, right: any) => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {}),
  };
  imports['@/lib/opencode/client'] = {
    buildClient: (settings: any) => settings, detectServerContract: async () => ({ contract: 'v2' }),
    getConnectionError: (_: any, reason: any) => reason.message, getNormalizedServerUrl: (url: any) => url,
    isContractMismatchError: () => false, isAuthConnectionFailure: (kind: any) => kind === 'auth' || kind === 'entitlement', isValidServerUrl: () => true,
    isRetryableCloudLinkStartupError: (reason: any) => /1033/.test(reason.message),
    classifyConnectionFailure: (reason: any) => /offline|catalog/i.test(String(reason?.message)) ? 'offline' : 'unknown',
  };
  const actions = await loadTs('providers/use-connection-connect-actions.ts', imports, globals);
  const profileHook = await loadTs('providers/use-connection-profiles.ts', {
    ...imports, '@/lib/opencode/client/url': {}, '@/lib/opencode/client/probe': {}, '@/lib/opencode/pairing': {},
  }, globals);
  const input: any = {
    isHydrated: true, settingsRef: ref(undefined), connectionRef: ref({ status: 'idle' }), activeProjectPathRef: ref('/fixture'),
    serverGenerationRef: ref(0), scopeGenerationRef: ref(0), catalogGenerationRef: ref(new WeakMap()),
    initialConnectStartedRef: ref(false), serverContractRef: ref('v2'), serverProjectsRef: ref([]), chatPreferencesRef: ref({ enabledModelIds: [], recentModelIds: [], providerModelSelections: {} }),
    clearProjectState: () => { resets++; },
    softResetProjectState: () => { softResets++; },
    isCurrentCatalogClient: (client: any) => input.catalogGenerationRef.current.get(client) === input.serverGenerationRef.current,
    loadProjectCatalog: async () => { catalogs++; if (catalogFailure) throw new Error(typeof catalogFailure === 'string' ? catalogFailure : 'offline'); return { currentProjectPath: '/fixture', serverProjects: [], serverRootPath: '/fixture' }; },
  };
  for (const key of ['setServerProjects', 'setCurrentProjectPath', 'setServerRootPath', 'setSessions', 'setSessionStatuses', 'setCurrentConfig', 'setAvailableProviders', 'setProviderAuthMethodsById', 'setAvailableModels', 'setAvailableAgents', 'setMessagesBySession', 'setDiffsBySession', 'setTodosBySession', 'setFavoriteSessions', 'setLastSessionByConnection', 'setChatPreferences', 'setDiagnostics', 'setSendingState']) input[key] = noop;
  runtime.mount(() => {
    const [settings, setSettings] = runtime.react.useState({ serverUrl: profile.serverUrl, username: profile.username, password: missing ? '' : claim.device_secret, directory: '', connect: profile.connect });
    const [connection, setConnection] = runtime.react.useState({ status: 'idle', message: '' });
    const [activeProjectPath, setActiveProjectPath] = runtime.react.useState('/fixture');
    const [controlPlaneUrl, setControlPlaneUrl] = runtime.react.useState(CP);
    runtime.react.useLayoutEffect(() => { input.settingsRef.current = settings; input.connectionRef.current = connection; input.activeProjectPathRef.current = activeProjectPath; });
    const bridge = runtime.react.useRef<any>(null);
    const forward = runtime.react.useCallback((...args: any[]) => bridge.current.switchConnection(...args), []);
    const disconnect = runtime.react.useCallback(async () => bridge.current.updateSettings({ serverUrl: '', username: '', password: '', connect: undefined }), []);
    const connectSetup = setup.useConnectState({ controlPlaneUrl, setControlPlaneUrl, switchConnection: forward, disconnect, isHydrated: true,
      activeMachineId: settings.connect?.machineId, beforeProfileRefresh: async () => {}, onProfileRefreshed: () => {},
      isActiveProfile: (candidate: any) => Boolean(input.settingsRef.current.connect && profiles.findMatchingProfile([candidate], input.settingsRef.current)) });
    const result = actions.useConnectionConnectActions({ ...input, settings, setSettings, connection, setConnection, activeProjectPath, setActiveProjectPath, controlPlaneUrl, setControlPlaneUrl, connectSetup });
    runtime.react.useLayoutEffect(() => { bridge.current = result; });
    const connectionProfiles = profileHook.useConnectionProfiles({ settings, switchConnection: result.switchConnection, updateSettings: result.updateSettings, profileSnapshot: result.connectSetup.profiles });
    return { ...result, settings, connection, activeProjectPath, connectionProfiles };
  }, {});
  return { runtime, profile, profiles, get accesses() { return accessCalls; }, get pairClaims() { return pairClaims; }, get catalogs() { return catalogs; }, get resets() { return resets; }, get softResets() { return softResets; },
    failAccess(value: any) { accessFailure = value; }, failCatalog(value: any) { catalogFailure = value; }, blockAccess() { accessGate = deferred<void>(); return accessGate; },
    advance(ms: number) { now += ms; }, appState(state: string) { native.AppState.currentState = state; [...listeners].forEach((listener: any) => listener(state)); runtime.flush(); },
  };
}

// A healthy reopen neither rotates credentials nor manufactures an unsaved row.
{
  const f = await fixture(); await f.runtime.settle();
  await f.runtime.value.connect(); await f.runtime.settle();
  f.appState('background'); f.advance(1000); f.appState('active'); await f.runtime.settle();
  assert.equal(f.accesses, 0);
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.runtime.value.connectionProfiles.profiles.length, 1);
  f.runtime.unmount();
}
// Returning after a network error reconnects without rotating valid credentials.
{
  const f = await fixture(); await f.runtime.settle(); f.failCatalog(true);
  await f.runtime.value.connect(); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'error');
  f.appState('background'); f.failCatalog(false); f.appState('active');
  f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.accesses, 0, 'An offline connection reuses valid credentials on foreground return.');
  f.runtime.unmount();
}
// An unchanged paid-through date does not create a recurring rotation loop.
{
  const f = await fixture({ ttl: 120000, unchangedExpiry: true }); await f.runtime.settle();
  f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.accesses, 1);
  f.appState('background'); f.advance(1000); f.appState('active'); await f.runtime.settle();
  await f.runtime.value.connect(); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.countTimers(1000), 0);
  f.advance(119000); f.runtime.fire(119000); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'error', 'Foreground expiry still blocks old credentials.');
  assert.equal(f.runtime.countTimers(1000), 1, 'Foreground expiry schedules recovery even after an unchanged paid-through refresh.');
  f.runtime.unmount();
}
// Failed native initialization surfaces an error without sending expired auth.
{
  const gate = deferred<void>();
  const f = await fixture({ expired: true, storedSession: false, storeGate: gate });
  const boot = f.runtime.value.connect(); await f.runtime.settle();
  gate.reject(new Error('native store unavailable')); await f.runtime.settle(); await boot;
  assert.equal(f.accesses, 0); assert.equal(f.catalogs, 0);
  assert.equal(f.runtime.value.connection.status, 'error');
  f.runtime.unmount();
}
// Automatic retry recovers after the existing 60-second delay.
{
  const f = await fixture({ expired: true }); await f.runtime.settle(); f.failAccess(true);
  f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.countTimers(60000), 1);
  f.failAccess(false); f.advance(60000); f.runtime.fire(60000); f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.accesses, 2); assert.equal(f.runtime.value.connection.status, 'connected');
  f.runtime.unmount();
}
// Already-expired credentials returned by the backend remain blocked and back off.
{
  const f = await fixture({ expired: true, unchangedExpiry: true }); await f.runtime.settle();
  f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.catalogs, 0);
  assert.equal(f.runtime.countTimers(1000), 0); assert.equal(f.runtime.countTimers(60000), 1);
  f.runtime.unmount();
}
// Resume past expiry recovers automatically and retries failures only while active.
{
  const f = await fixture(); await f.runtime.settle(); await f.runtime.value.connect();
  f.appState('background'); f.advance(660000); f.failAccess(true); f.appState('active');
  assert.equal(f.runtime.value.connection.status, 'error');
  assert.equal(f.runtime.countTimers(1000), 1);
  f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.value.connection.status, 'error');
  assert.equal(f.runtime.countTimers(60000), 1);
  f.appState('background'); assert.equal(f.runtime.countTimers(60000), 0);
  f.failAccess(false); f.appState('active'); f.runtime.fire(1000); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.runtime.value.connectSetup.phase, 'idle', 'Automatic recovery releases the secure-save phase.');
  assert.equal(f.runtime.value.activeProjectPath, '/fixture');
  assert.equal(f.runtime.value.connectionProfiles.profiles[0].username, f.runtime.value.settings.username);
  f.runtime.unmount();
}
// Cold launch waits for native-store recovery and shares access with initialization.
{
  const gate = deferred<void>();
  const f = await fixture({ expired: true, storedSession: false, storeGate: gate });
  const boot = f.runtime.value.connect(); await f.runtime.settle();
  assert.equal(f.accesses, 0); assert.equal(f.catalogs, 0);
  gate.resolve(); await f.runtime.settle(); await boot; await f.runtime.settle();
  assert.equal(f.accesses, 1);
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.runtime.value.activeProjectPath, '/fixture');
  assert.equal(f.runtime.value.connectSetup.error, undefined);
  assert.equal(f.runtime.value.connectSetup.initialization, 'ready');
  f.runtime.unmount();
}
// Simultaneous manual/automatic preparation gets one rotated credential pair.
{
  const f = await fixture({ missing: true }); await f.runtime.settle();
  const gate = f.blockAccess();
  const first = f.runtime.value.connect(), second = f.runtime.value.connect();
  await f.runtime.settle(); assert.equal(f.accesses, 1);
  assert.equal(f.runtime.value.connectSetup.selectControlPlane('https://apistaging.opencodecloud.link'), false, 'An access request must retain its authenticated environment.');
  gate.resolve(); await Promise.all([first, second]); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.resets, 1, 'only the expiry reset clears state');
  assert.equal(f.softResets, 1, 'a same-machine credential rotation keeps server-derived state');
  assert.equal(f.catalogs, 1, 'concurrent connects share one project discovery');
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.runtime.value.activeProjectPath, '/fixture', 'a same-machine rotation keeps the selected project');
  f.runtime.unmount();
}
// A request finishing after backgrounding must not rearm a retry timer.
{
  const f = await fixture({ expired: true }); await f.runtime.settle();
  const gate = f.blockAccess(); f.failAccess(true);
  f.runtime.fire(1000); await f.runtime.settle();
  f.appState('background'); gate.resolve(); await f.runtime.settle();
  assert.equal(f.runtime.countTimers(60000), 0);
  f.runtime.unmount();
}
// Switching machines during recovery must discard both success and failure.
for (const [fail, cloud] of [[false, false], [true, false], [false, true], [true, true]]) {
  const f = await fixture({ expired: true }); await f.runtime.settle();
  const gate = f.blockAccess();
  const recovery = f.runtime.value.connect(); await f.runtime.settle();
  const next = cloud ? await f.profiles.saveConnectProfile(CP, { server_url: 'https://other.test', machine_id: 'machine-b', machine_name: 'Other', device_id: 'device-b', device_secret: 'secret-b', expires_at: new Date(Date.now() + 3600000).toISOString() }) : undefined;
  const serverUrl = next?.serverUrl ?? 'https://manual.test';
  f.runtime.value.updateSettings({ serverUrl, username: next?.username ?? 'manual', password: cloud ? 'secret-b' : '', connect: next?.connect });
  f.runtime.flush(); await f.runtime.value.connect(); await f.runtime.settle();
  f.failAccess(fail); gate.resolve(); await recovery; await f.runtime.settle();
  assert.equal(f.runtime.value.settings.serverUrl, serverUrl);
  assert.equal(f.runtime.value.connection.status, 'connected');
  f.runtime.unmount();
}
// Renewal while mounted refreshes the same profile and keeps the project.
{
  const f = await fixture(); await f.runtime.settle(); await f.runtime.value.connect();
  assert.equal(await f.runtime.value.connectSetup.restore(), true); await f.runtime.settle();
  assert.equal(f.accesses, 1); assert.equal(f.runtime.value.activeProjectPath, '/fixture');
  assert.equal(f.runtime.value.connection.status, 'connected');
  const saved = f.runtime.value.connectionProfiles.profiles;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, f.profile.id);
  assert.equal(saved[0].username, f.runtime.value.settings.username);
  f.runtime.unmount();
}
// Renewing an inactive Cloud Link also updates the mounted connection list.
{
  const f = await fixture(); await f.runtime.settle();
  f.runtime.value.updateSettings({ serverUrl: 'https://manual.test', username: 'manual', password: '', connect: undefined });
  await f.runtime.settle();
  assert.equal(await f.runtime.value.connectSetup.restore(), true); await f.runtime.settle();
  assert.equal(f.runtime.value.settings.serverUrl, 'https://manual.test');
  const stored = await f.profiles.loadConnectionProfiles();
  assert.equal(f.runtime.value.connectionProfiles.profiles[0].username, stored[0].username);
  assert.notEqual(stored[0].username, f.profile.username);
  f.runtime.unmount();
}

// First-claim approval waiting owns recovery, including after an overdue resume.
const approvalQR = 'opencodemobile://pair?v=1&cp=https%3A%2F%2Fapi.opencodecloud.link&id=approval&t=one-use-token&n=Mac';
{
  const f = await fixture(); await f.runtime.settle(); f.failCatalog('Cloudflare Error 1033');
  await f.runtime.value.connectSetup.pairLink(approvalQR); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'waitingForApproval');
  assert.equal(f.pairClaims, 1); assert.equal(f.accesses, 0);
  assert.equal(f.runtime.countTimers(1000), 0, 'Foreground recovery must not compete with activation.');
  f.appState('background'); f.advance(3000); f.runtime.fire(3000); await f.runtime.settle();
  const before = f.catalogs;
  f.advance(180000); f.appState('active'); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'delayed');
  assert.equal(f.runtime.value.connectSetup.error, undefined);
  assert.equal(f.runtime.value.connectSetup.canRetry, true);
  assert.equal(f.catalogs, before, 'Overdue foreground return does not reconnect or restart the budget.');
  assert.equal(f.runtime.countTimers(1000), 0);
  f.appState('background'); f.appState('active'); await f.runtime.settle();
  assert.equal(f.catalogs, before);
  f.failCatalog(false);
  await f.runtime.value.connectSetup.retry(); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'paired');
  assert.equal(f.runtime.value.connection.status, 'connected');
  assert.equal(f.pairClaims, 1, 'Retry must not replay the QR claim.');
  assert.equal(f.accesses, 0, 'Retry must not rotate credentials or refresh machine access.');
  assert.equal(f.runtime.value.settings.password, 'secret-a');
  f.runtime.unmount();
}
// Rescan retires only the activation checkpoint and accepts the connector's new QR.
{
  const f = await fixture(); await f.runtime.settle(); f.failCatalog('Cloudflare Error 1033');
  await f.runtime.value.connectSetup.pairLink(approvalQR); await f.runtime.settle();
  f.advance(120000); f.runtime.fire(3000); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'delayed');
  await f.runtime.value.connectSetup.cancelPairing(); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'idle');
  assert.equal((await f.profiles.loadConnectionProfiles()).length, 1);
  assert.equal(await f.profiles.getProfilePassword(f.profile.id), 'secret-a');
  f.failCatalog(false);
  await f.runtime.value.connectSetup.pairLink(approvalQR.replace('id=approval', 'id=new-approval')); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'paired'); assert.equal(f.pairClaims, 2);
  f.runtime.unmount();
}

// A still-valid post-claim credential is not rotated after a minute of waiting.
{
  const f = await fixture({ ttl: 240000 }); await f.runtime.settle(); f.failCatalog('Cloudflare Error 1033');
  await f.runtime.value.connectSetup.pairLink(approvalQR); await f.runtime.settle();
  f.advance(63000); f.runtime.fire(3000); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'waitingForApproval');
  assert.equal(f.accesses, 0, 'Near-expiry preparation must reuse valid activation credentials.');
  f.runtime.unmount();
}
// A connection selected during the wait cannot be replaced by the old activation.
{
  const f = await fixture(); await f.runtime.settle(); f.failCatalog('Cloudflare Error 1033');
  await f.runtime.value.connectSetup.pairLink(approvalQR); await f.runtime.settle();
  const before = f.catalogs;
  f.runtime.value.updateSettings({ serverUrl: 'http://manual.test', username: '', password: '', connect: undefined });
  await f.runtime.settle(); f.advance(3000); f.runtime.fire(3000); await f.runtime.settle();
  assert.equal(f.runtime.value.connectSetup.phase, 'idle');
  assert.equal(f.runtime.value.settings.serverUrl, 'http://manual.test');
  assert.equal(f.catalogs, before, 'A stale activation must not switch back to its saved profile.');
  f.runtime.unmount();
}

// Data-plane revocation stops automatic retries and surfaces an actionable state.
{
  const f = await fixture(); await f.runtime.settle();
  f.runtime.value.updateSettings({ serverUrl: 'http://manual.test', username: '', password: '', connect: undefined }); await f.runtime.settle();
  await f.runtime.value.connect(); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'connected');
  const before = f.resets;
  f.runtime.value.handleStreamAuthFailure('auth'); await f.runtime.settle();
  assert.equal(f.runtime.value.connection.status, 'error');
  assert.equal(f.runtime.value.connection.kind, 'auth');
  assert.equal(f.resets, before + 1, 'revocation clears server-derived caches once');
  f.runtime.value.handleStreamAuthFailure('auth'); await f.runtime.settle();
  assert.equal(f.resets, before + 1, 'a repeated failure is not cleared twice');
  f.runtime.unmount();
}
// Cloud Link revocation reuses the prepared credential recovery path.
{
  const f = await fixture({ expired: true }); await f.runtime.settle();
  f.runtime.value.handleStreamAuthFailure('entitlement'); await f.runtime.settle();
  assert.equal(f.accesses, 1);
  assert.equal(f.runtime.value.connection.status, 'connected');
  f.runtime.unmount();
}

  });
});
