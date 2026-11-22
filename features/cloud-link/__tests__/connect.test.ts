// @vitest-environment happy-dom

import { cloudLinkPlatform as device } from '../../../tests/helpers/cloud-link-platform';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProductSubscription, Purchase } from 'expo-iap';
import { act, createElement, useState } from 'react';
import { describe, it, vi } from 'vitest';

import * as contract from '@/shared/contracts/cloud-link';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { connectCatalogOptions } from '@/features/cloud-link/services/queries/cloud-link';
import * as subscriptionService from '@/features/cloud-link/services/connect-subscription-service';
import { useConnectState } from '@/features/cloud-link/state/connect/use-connect-machine';
import { openTerminalWebSocket } from '@/features/terminal/services/terminal-service';
import * as storeApi from '@/shared/platform/billing/connect-store';
import * as http from '@/shared/protocol/cloud-link/connect';
import { getConnectionError } from '@/shared/protocol/opencode/client/errors';
import * as storage from '@/shared/storage/cloud-link';
import { deferred, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

type BuildProbe = {
  commands: { command: string; args: string[]; env: NodeJS.ProcessEnv }[];
  writes: string[];
};
const build = vi.hoisted(() => ({ probe: undefined as BuildProbe | undefined }));

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawnSync: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    assert.ok(build.probe, 'Build commands must run inside the process fixture.');
    build.probe.commands.push({ command, args, env: options?.env ?? process.env });
    return { status: 0, stdout: 'Alias name: test\n' };
  } };
});
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  // Only the build script's default import uses these in-memory files.
  return { ...actual, default: {
    ...actual,
    existsSync: () => true,
    copyFileSync() {},
    statSync: () => ({ size: 128 }),
    readFileSync: (_path: string, encoding?: string) => encoding === 'utf8'
      ? 'reactNativeArchitectures=arm64-v8a\nAsyncStorage_db_size_in_MB=64\n' : Buffer.alloc(128),
    appendFileSync: (_path: string, data: unknown) => { build.probe?.writes.push(String(data)); },
    writeFileSync() {},
  } };
});

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

function mountConnect(controlPlane: string, overrides: Partial<Parameters<typeof useConnectState>[0]> = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  focusManager.setFocused(true);
  const runtime = renderHook(() => {
    const [controlPlaneUrl, setControlPlaneUrl] = useState(controlPlane);
    const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
    return useConnectState({
      profiles, setProfiles, controlPlaneUrl, setControlPlaneUrl, isHydrated: true,
      migrateConnectConnectionScope: async () => {},
      switchConnection: async () => ({ status: 'connected', message: 'Connected' }), disconnect: async () => {},
      beforeProfileRefresh: async () => {}, onProfileRefreshed: () => {}, isActiveProfile: () => true,
      ...overrides,
    });
  }, undefined, ({ children }) => createElement(QueryClientProvider, { client: cache }, children));
  return { ...runtime, unmount() { runtime.unmount(); cache.clear(); focusManager.setFocused(undefined); } };
}

describe('connect and Cloud Link pairing', () => {
  it('connect and Cloud Link pairing', async () => {

const connect = { ...contract, ...storage, ...http };
device.config = { extra: { connectPilot: {} }, android: { package: 'app.getopencode' } };
device.os = 'ios';
device.secrets.clear();
device.preferences.clear();
const tunnelHtmlError = new Error('<html><meta content="text/html">Cloudflare Error 1033</html>');
assert.match(getConnectionError('https://machine.example.test', tunnelHtmlError), /1033/);
assert.equal(new connect.ConnectApiError(403, { error: 'Google test purchases are disabled in this environment' }).testPurchase, true);
assert.equal(new connect.ConnectApiError(403, { error: 'no active subscription' }).testPurchase, false);
assert.equal(new connect.ConnectApiError(502, { error: 'Google test purchases are disabled in this environment' }).testPurchase, false);
assert.equal(new connect.ConnectApiError(403, { error: 'no active subscription' }).noActiveSubscription, true);
assert.equal(new connect.ConnectApiError(403, { error: 'another denial' }).noActiveSubscription, false);
assert.equal(new connect.ConnectApiError(502, { error: 'no active subscription' }).noActiveSubscription, false);
assert.match(new connect.ConnectApiError(403, { code: 'capacity_reached' }).message, /provisioning is pending/);
assert.equal(new connect.ConnectApiError(403, { code: 'capacity_reached' }).noActiveSubscription, false);
assert.doesNotMatch(new connect.ConnectApiError(403, { error: 'another denial' }).message, /No active Cloud Link entitlement/);
assert.deepEqual(connect.parseConnectActivation({ state: 'pending_approval', retry_after_ms: 2000, expires_at: '2030-01-01T00:00:00Z' }), { state: 'pending_approval', retry_after_ms: 2000, expires_at: '2030-01-01T00:00:00Z' });
assert.deepEqual(connect.parseConnectActivation({ state: 'ready', ready_at: '2030-01-01T00:00:00Z' }), { state: 'ready', ready_at: '2030-01-01T00:00:00Z' });
assert.equal(connect.parseConnectActivation(undefined), undefined);
assert.equal(connect.parseConnectActivation({ state: 'unknown' }), undefined);
assert.equal(connect.parseConnectActivation({ state: 'ready', retry_after_ms: -1 }), undefined);
assert.equal(connect.parseConnectActivation({ state: 'ready', ready_at: 'not-a-date' }), undefined);
const errorActivation = new connect.ConnectApiError(409, { machine_id: 'machine-1', activation: { state: 'tunnel_starting', retry_after_ms: 2000 } });
assert.equal(errorActivation.machineId, 'machine-1');
assert.deepEqual(errorActivation.activation, { state: 'tunnel_starting', retry_after_ms: 2000 });
assert.equal(new connect.ConnectApiError(409, { error: 'activation readiness is not available' }).activationUnsupported, true);
const url = new URL('opencodemobile://pair');
for (const [key, value] of Object.entries({ v: '1', cp: 'https://api.opencodecloud.link', id: 'pair-1', t: 'temporary-token', n: 'Mac & Studio' })) url.searchParams.set(key, value);
const pairing = connect.parseConnectPairing(url.toString());
assert.equal(connect.isConnectEnabled(), true, 'Native pairing must not depend on a development flag.');
assert.deepEqual(connect.getConnectControlPlanes(), ['https://api.opencodecloud.link', 'https://apistaging.opencodecloud.link'], 'Only the two fixed environments are trusted.');
assert.equal(pairing.machineName, 'Mac & Studio');
assert.equal(pairing.pairingToken, 'temporary-token');
assert.deepEqual(connect.parseConnectPairing(Object.fromEntries(url.searchParams)), pairing);
for (const field of ['v', 'cp', 'id', 't', 'n']) {
  const missing = new URL(url); missing.searchParams.delete(field);
  assert.throws(() => connect.parseConnectPairing(missing.toString()), /Invalid/);
}
for (const [field, value] of [['v', '2'], ['id', '../other'], ['cp', 'https://attacker.test'], ['cp', 'https://api.opencodecloud.link@attacker.test'], ['cp', 'http://api.opencodecloud.link'], ['cp', 'http://127.0.0.1:8787']]) {
  const bad = new URL(url); bad.searchParams.set(field, value);
  assert.throws(() => connect.parseConnectPairing(bad.toString()));
}
assert.throws(() => connect.parseConnectPairing(`${url}&id=duplicate`));
assert.throws(() => connect.parseConnectPairing(url.toString().replace('://pair?', '://other?')));
const legacySecrets = new Map();
for (const legacyControlPlane of ['https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
  const legacyLink = new URL(url); legacyLink.searchParams.set('cp', legacyControlPlane);
  assert.throws(() => connect.normalizeTrustedControlPlaneUrl(legacyControlPlane), /trusted/);
  assert.throws(() => connect.parseConnectPairing(legacyLink.toString()), /trusted/);
  const legacyMetadata = { controlPlaneUrl: legacyControlPlane, machineId: 'legacy-machine', machineName: 'Mac', deviceId: 'legacy-device', expiresAt: '2030-01-01T00:00:00Z' };
  assert.deepEqual(connect.parseConnectMetadata(legacyMetadata), legacyMetadata, 'Legacy profiles remain readable.');
  assert.match(connect.getConnectCredentialError(legacyMetadata, 'legacy-secret')!, /trusted/);
  await assert.rejects(connect.getConnectSession(legacyControlPlane, 'apple'), /trusted/);
  const legacySegment = Array.from(legacyControlPlane).map((char) => char.charCodeAt(0).toString(16)).join('-');
  for (const kind of ['session', 'pairing']) {
    const key = `opencode-mobile.connect-${kind}.apple.${legacySegment}`;
    const value = JSON.stringify({ legacy: kind });
    legacySecrets.set(key, value);
    device.secrets.set(key, value);
  }
}
for (const controlPlane of connect.getConnectControlPlanes()) {
  assert.equal(await connect.getConnectSession(controlPlane, 'apple'), undefined, 'New environments do not reuse legacy sessions.');
  assert.equal(await connect.getPendingConnectPairing(controlPlane, 'apple'), undefined, 'New environments do not reuse legacy QR records.');
}
for (const [key, value] of legacySecrets) assert.equal(device.secrets.get(key), value, 'Legacy secure records remain untouched.');
const session = { user_id: 'owner', user_token: 'user-token', session_expires_at: new Date(Date.now() + 86400000).toISOString(), subscription_expires_at: new Date(Date.now() + 3600000).toISOString(), entitlements: ['cloudlink'] };
await connect.saveConnectSession(pairing.controlPlaneUrl, 'apple', session);
assert.deepEqual(await connect.getConnectSession(pairing.controlPlaneUrl, 'apple'), session);
assert.equal(await connect.getConnectSession(pairing.controlPlaneUrl, 'google'), undefined, 'Store identities stay separate.');
await assert.rejects(connect.getConnectSession('http://127.0.0.1:8787', 'apple'), /HTTPS/);
assert.equal(connect.hasConnectEntitlement(session), true);
assert.equal(connect.hasConnectEntitlement({ ...session, entitlements: ['connect'] }), true, 'Legacy sessions remain entitled.');
assert.equal(connect.hasConnectEntitlement({ ...session, entitlements: ['unrelated'] }), false);
assert.equal(connect.hasConnectEntitlement({ ...session, session_expires_at: '2000-01-01T00:00:00Z' }), false);
assert.equal(connect.hasConnectEntitlement({ ...session, subscription_expires_at: '2000-01-01T00:00:00Z' }), false);
assert.equal(connect.hasConnectSession({ ...session, subscription_expires_at: '2000-01-01T00:00:00Z' }), true, 'Entitlement expiry does not erase a valid identity session.');
await connect.savePendingConnectPairing(pairing.controlPlaneUrl, 'apple', pairing);
assert.deepEqual(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), pairing);
await connect.savePendingConnectPairing(pairing.controlPlaneUrl, 'apple');
assert.equal(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), undefined);

assert.equal(connect.normalizeControlPlaneUrl('  https://STAGING.example.test/connect///  '), 'https://staging.example.test/connect');
const customControlPlane = connect.normalizeTrustedControlPlaneUrl('  https://APISTAGING.opencodecloud.link///  ');
assert.equal(customControlPlane, 'https://apistaging.opencodecloud.link');
assert.throws(() => connect.normalizeTrustedControlPlaneUrl('https://staging.example.test'), /trusted/);
for (const invalid of ['http://localhost:8787', 'ftp://staging.example.test', 'https://user:secret@staging.example.test', 'https://staging.example.test?token=x', 'https://staging.example.test#fragment', 'not-a-url']) {
  assert.throws(() => connect.normalizeControlPlaneUrl(invalid));
}
const customLink = new URL(url);
customLink.searchParams.set('cp', customControlPlane);
const customPairing = connect.parseConnectPairing(customLink.toString(), customControlPlane);
assert.deepEqual(connect.parseConnectPairing(customLink.toString()), customPairing);
assert.equal(customPairing.controlPlaneUrl, customControlPlane);
assert.throws(() => connect.parseConnectPairing(url.toString(), customControlPlane), /subscription environment/);
await connect.saveConnectSession(customControlPlane, 'apple', { ...session, user_token: 'staging-token' });
assert.equal((await connect.getConnectSession(customControlPlane, 'apple'))!.user_token, 'staging-token');
assert.equal((await connect.getConnectSession(pairing.controlPlaneUrl, 'apple'))!.user_token, 'user-token');
await connect.savePendingConnectPairing(customControlPlane, 'apple', customPairing);
assert.deepEqual(await connect.getPendingConnectPairing(customControlPlane, 'apple'), customPairing);
assert.equal(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), undefined);

const calls: { address: any; init: any }[] = [];
const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'Machine', device_id: 'device-1', device_secret: 'signed-credential', expires_at: new Date(Date.now() + 60_000).toISOString() };
let status = 200, response: any = claim;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address: any, init: any) => { calls.push({ address, init }); return new Response(status === 204 ? null : JSON.stringify(response), { status }); };
try {
  for (const legacyControlPlane of ['https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
    await assert.rejects(connect.getConnectCatalog(legacyControlPlane), /trusted/);
    await assert.rejects(connect.claimConnectSubscription(legacyControlPlane, { store: 'apple', signedTransaction: 'native.jws.proof' }), /trusted/);
  }
  assert.equal(calls.length, 0, 'Legacy endpoints must be rejected before sending any request or store proof.');
  assert.deepEqual(await connect.claimConnectPairing(pairing, 'user-token', ' My phone '), claim);
  assert.equal(calls[0].address, 'https://api.opencodecloud.link/v1/pairings/pair-1/claim');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { pairing_token: 'temporary-token', device_name: 'My phone' });
  assert.ok(!calls[0].address.includes('temporary-token'));
  assert.equal(calls[0].init.redirect, 'error');
  for (const expected of [401, 403, 404, 409, 429, 502]) {
    status = expected;
    await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'), (error: any) => error.status === expected && !error.message.includes('signed-credential'));
  }
  status = 200;
  for (const invalid of [{ ...claim, device_secret: undefined }, { ...claim, expires_at: 'bad' }, { ...claim, expires_at: '2000-01-01T00:00:00Z' }, { ...claim, server_url: 'http://m.example.test' }, { ...claim, server_url: 'https://user:secret@m.example.test' }]) {
    response = invalid; await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'));
  }
  response = { machines: [{ id: 'machine-1', name: 'Machine', hostname: 'm.example.test', public_url: claim.server_url, created_at: '2026-10-02T00:00:00Z', access_enabled: true }] };
  assert.equal((await connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'))[0].id, 'machine-1');
  response = claim;
  assert.equal((await connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token')).machine_id, 'machine-1');
  const activationClaim = { ...claim, activation: { state: 'pending_approval', retry_after_ms: 2000, expires_at: new Date(Date.now() + 30_000).toISOString() } };
  assert.deepEqual(connect.parseConnectClaim(pairing.controlPlaneUrl, activationClaim).activation, activationClaim.activation);
  assert.equal('activation' in connect.parseConnectClaim(pairing.controlPlaneUrl, claim), false);
  assert.equal(connect.parseConnectClaim(pairing.controlPlaneUrl, { ...claim, activation: { state: 'invalid' } }).activation, undefined);
  status = 200;
  response = { state: 'pending_approval', retry_after_ms: 2000 };
  assert.deepEqual(await connect.getConnectPairingActivation(pairing.controlPlaneUrl, 'pair-1', 'user-token'), response);
  assert.equal(calls.at(-1)!.address, 'https://api.opencodecloud.link/v1/pairings/pair-1/activation');
  assert.equal(calls.at(-1)!.init.method, 'GET');
  assert.equal(calls.at(-1)!.init.headers.Authorization, 'Bearer user-token');
  response = { state: 'tunnel_starting', retry_after_ms: 1000 };
  assert.deepEqual(await connect.getConnectMachineActivation(pairing.controlPlaneUrl, 'machine-1', 'user-token'), response);
  assert.equal(calls.at(-1)!.address, 'https://api.opencodecloud.link/v1/machines/machine-1/activation');
  response = { state: 'invalid' };
  assert.equal(await connect.getConnectMachineActivation(pairing.controlPlaneUrl, 'machine-1', 'user-token'), undefined);
  response = { ...claim, machine_id: 'other-machine' };
  await assert.rejects(connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token'), /machine_identity_mismatch/);
  response = { ...session, acknowledgement_pending: true };
  assert.deepEqual(await connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' }), session);
  assert.equal(calls.at(-1)!.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls.at(-1)!.init.body), { store: 'apple', signedTransaction: 'native.jws.proof' });
  assert.ok(!calls.at(-1)!.address.includes('native.jws.proof'));
  const beforeClaims = calls.length;
  const sharedClaims = await Promise.all([1, 2, 3].map(() => connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' })));
  assert.equal(calls.length, beforeClaims + 1, 'Concurrent recovery shares one verification request.');
  sharedClaims[0].entitlements.length = 0;
  assert.deepEqual(sharedClaims[1].entitlements, ['cloudlink'], 'Consumers do not share mutable session arrays.');
  await connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' });
  assert.equal(calls.length, beforeClaims + 2, 'Completed claims are not cached.');
  status = 403;
  response = { error: 'no active subscription' };
  const beforeFailedClaims = calls.length;
  const denied = await Promise.allSettled([1, 2].map(() => connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' })));
  assert.ok(denied.every((result) => result.status === 'rejected'));
  assert.equal(calls.length, beforeFailedClaims + 1);
  status = 200;
  response = session;
  await connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' });
  assert.equal(calls.length, beforeFailedClaims + 2, 'Rejected shared claims remain retryable.');
  const catalog = { plans: [{ id: 'connect', entitlements: ['connect'], products: [{ store: 'apple', productId: 'test.apple' }, { store: 'google', productId: 'test.google', basePlanId: 'monthly', offerIds: ['trial'] }] }] };
  response = catalog;
  const beforeCatalog = calls.length;
  const queryCache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 300_000 } } });
  const readCatalog = (url: string) => queryCache.fetchQuery({ queryKey: ['cloudlink', url, 'catalog'], queryFn: () => connect.getConnectCatalog(url) });
  const catalogs = await Promise.all([1, 2].map(() => readCatalog(pairing.controlPlaneUrl)));
  assert.deepEqual(catalogs[0], catalog);
  assert.equal(calls.length, beforeCatalog + 1, 'Concurrent catalog reads share one request.');
  const view = structuredClone(catalogs[0]); view.plans.length = 0;
  assert.deepEqual(await readCatalog(pairing.controlPlaneUrl), catalog);
  assert.equal(calls.length, beforeCatalog + 1, 'Cached catalog is protected from consumer mutation.');
  await readCatalog(customControlPlane);
  assert.equal(calls.length, beforeCatalog + 2, 'Production and staging catalogs are separate.');
  assert.equal(calls.at(-1)!.init.headers.Authorization, undefined);
  response = { plans: [catalog.plans[0], catalog.plans[0]] };
  const originalNow = Date.now;
  try {
    const expired = originalNow() + 5 * 60_000 + 1;
    Date.now = () => expired;
    await assert.rejects(readCatalog(pairing.controlPlaneUrl), /Ambiguous/);
    response = catalog;
    assert.deepEqual(await readCatalog(pairing.controlPlaneUrl), catalog, 'Failed refreshes can be retried.');
  } finally { Date.now = originalNow; }
  // The provider attributes store events through this catalog without a mounted
  // React observer; eviction would silently drop a paid transaction until restart.
  const retained = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 25, staleTime: 300_000 } } });
  const retainedOptions = connectCatalogOptions(pairing.controlPlaneUrl, 'apple');
  assert.deepEqual(await retained.fetchQuery(retainedOptions), catalog);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.deepEqual(retained.getQueryData(retainedOptions.queryKey), catalog, 'Purchase attribution must survive the default cache window.');
  retained.clear();
  assert.equal(new connect.ConnectApiError(409, { machine_id: 'machine-1' }).machineId, 'machine-1');
  assert.equal(new connect.ConnectApiError(503, { machine_id: 'machine-1' }).machineId, 'machine-1');
  status = 204;
  await connect.revokeConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token');
  assert.equal(calls.at(-1)!.init.method, 'DELETE');
  assert.equal(calls.at(-1)!.address, 'https://api.opencodecloud.link/v1/machines/machine-1');
  const count = calls.length;
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, ''), (error: any) => error.status === 401);
  device.os = 'web';
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'), /iOS and Android/);
  assert.throws(() => connect.parseConnectPairing(url.toString()), /iOS and Android/);
  assert.equal(calls.length, count, 'Missing authentication and unsupported platforms must not make account requests.');
  device.os = 'ios';
} finally { globalThis.fetch = originalFetch; }

// Verify native upgrades add Basic without putting credentials in the URL;
// browser upgrades retain the existing ticket-only behavior.
const originalSocket = globalThis.WebSocket;
globalThis.WebSocket = class { args: any[]; constructor(...args: any[]) { this.args = args; } } as any;
try {
  const socket = openTerminalWebSocket('wss://m.example.test/pty/1/connect?ticket=upstream', {
    Authorization: 'Basic device-credential', 'CF-Access-Client-Id': 'client-id', 'CF-Access-Client-Secret': 'client-secret',
  });
  assert.equal((socket as unknown as { args: unknown[] }).args[0], 'wss://m.example.test/pty/1/connect?ticket=upstream');
  assert.deepEqual((socket as unknown as { args: unknown[] }).args[2], { headers: { Authorization: 'Basic device-credential', 'CF-Access-Client-Id': 'client-id', 'CF-Access-Client-Secret': 'client-secret' } });
  device.os = 'web';
  assert.equal(connect.isConnectEnabled(), false);
  assert.deepEqual((openTerminalWebSocket('ws://local/pty?ticket=x', { Authorization: 'Basic secret' }) as unknown as { args: unknown[] }).args, ['ws://local/pty?ticket=x']);
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), '');
  device.config.extra.e2eMode = true;
  device.config.extra.connectPilot.testing = true;
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), 'value');
} finally { globalThis.WebSocket = originalSocket; }

async function appConfig(variant: string, controlPlaneUrl?: string) {
  vi.stubEnv('EXPO_APP_VARIANT', variant);
  vi.stubEnv('EXPO_PUBLIC_E2E_MODE', '1');
  vi.stubEnv('EXPO_CONNECT_CONTROL_PLANE_URL', controlPlaneUrl);
  vi.stubEnv('EXPO_CONNECT_CONTROL_PLANES', 'http://127.0.0.1:8787');
  vi.stubEnv('EXPO_CONNECT_TEST_USER_TOKEN', 'configured-test-token');
  try {
    vi.resetModules();
    return (await import('../../../app.config')).default;
  } finally {
    vi.unstubAllEnvs();
  }
}
const production = await appConfig('production'), development = await appConfig('development');
assert.equal(production.extra!.connectControlPlaneUrl, undefined);
assert.equal(development.extra!.connectControlPlaneUrl, undefined);
device.config = await appConfig('production', `${customControlPlane}/`);
assert.deepEqual(connect.getConnectControlPlanes(), [connect.CONNECT_PRODUCTION_URL, connect.CONNECT_STAGING_URL]);
device.config = await appConfig('production', 'http://localhost:8787');
assert.deepEqual(connect.getConnectControlPlanes(), [connect.CONNECT_PRODUCTION_URL, connect.CONNECT_STAGING_URL]);
assert.equal(production.extra!.connectPilot.enabled, undefined);
assert.equal(production.extra!.connectPilot.controlPlanes, undefined);
assert.equal(production.extra!.connectPilot.testUserToken, undefined);
assert.equal(development.extra!.connectPilot.testUserToken, undefined);
assert.equal(development.extra!.connectPilot.controlPlanes, undefined);
assert.notEqual(production.ios!.bundleIdentifier, development.ios!.bundleIdentifier);
assert.notEqual(production.android!.package, development.android!.package);
for (const config of [production, development]) {
  assert.ok(config.plugins!.some((plugin: any) => Array.isArray(plugin) && plugin[0] === 'expo-camera'), 'Every native build needs camera permission configuration.');
  device.config = config;
  for (const platform of ['ios', 'android']) {
    device.os = platform;
    assert.equal(connect.isConnectEnabled(), true);
    assert.deepEqual(connect.parseConnectPairing(url.toString()), pairing);
  }
}

// The FOSS (F-Droid) variant disables Cloud Link and drops the proprietary
// Play Billing / ML Kit barcode plugins.
const foss = await appConfig('foss');
assert.equal(foss.extra!.foss, true);
assert.equal(foss.android!.package, 'app.getopencode.fdroid');
assert.ok(!foss.plugins!.some((plugin: any) => Array.isArray(plugin) && plugin[0] === 'expo-camera'), 'FOSS build must not configure the camera/ML Kit plugin.');
assert.ok(!foss.plugins!.includes('expo-iap'), 'FOSS build must not configure the Play Billing plugin.');
assert.ok(!foss.plugins!.includes('@siteed/sherpa-onnx.rn'), 'FOSS build must not configure Sherpa native libraries.');
assert.ok(production.plugins!.includes('@siteed/sherpa-onnx.rn'), 'Production keeps local Sherpa voice features.');
{
  const savedConfig = device.config;
  const savedPlatform = device.os;
  device.config = { extra: { foss: true } };
  device.os = 'android';
  assert.equal(connect.isConnectEnabled(), false, 'FOSS builds must disable Cloud Link.');
  device.config = savedConfig;
  device.os = savedPlatform;
}
// Gradle regenerates Expo configuration; it must use the same variant as
// prebuild, even when the caller has a conflicting variant in the environment.
for (const variant of ['development', 'production']) {
  const commands: BuildProbe['commands'] = [];
  const writes: string[] = [];
  build.probe = { commands, writes };
  const listeners = new Map(['exit', 'SIGINT', 'SIGTERM'].map((event) => [event, process.listeners(event)]));
  vi.stubEnv('EXPO_APP_VARIANT', variant === 'development' ? 'production' : 'development');
  vi.stubEnv('OPENCODE_BUILD_FLAVOR', 'production');
  vi.stubEnv('ANDROID_KEYSTORE_PATH', '/fake/store');
  vi.stubEnv('ANDROID_KEYSTORE_PASSWORD', 'test');
  vi.stubEnv('ANDROID_KEY_ALIAS', 'test');
  vi.stubEnv('ANDROID_KEY_PASSWORD', 'test');
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Build script failed'); });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    if (variant === 'development') await import('../../../scripts/build-android-development.mjs');
    else await import('../../../scripts/build-android-release.mjs');
  } finally {
    for (const [event, previous] of listeners) {
      for (const listener of process.listeners(event)) {
        if (!previous.includes(listener)) process.removeListener(event, listener);
      }
    }
    exit.mockRestore();
    log.mockRestore();
    vi.unstubAllEnvs();
    build.probe = undefined;
  }
  const nativeCommands = commands.filter(({ command }) => command === 'npx' || command === './gradlew');
  assert.deepEqual(nativeCommands.map(({ command }) => command), ['npx', './gradlew']);
  for (const command of nativeCommands) assert.equal(command.env.EXPO_APP_VARIANT, variant);
  // Signing credentials must never reach a command line; they are injected
  // through the generated gradle.properties instead.
  for (const { args } of commands) assert.ok(!args.includes('test'), `Build commands must not carry signing secrets: ${args.join(' ')}`);
  assert.ok(commands.some(({ command, args }: any) => command === './gradlew' && !args.some((arg: any) => String(arg).includes('signing'))), 'Gradle must not receive -Pandroid.injected.signing.* arguments.');
  // Only the release script signs, so only it writes signing properties.
  if (variant === 'production') {
    assert.ok(writes.some((data) => data.includes('android.injected.signing.store.password=test')), 'Signing credentials must be injected through gradle.properties.');
  }
}

// Test the actual store/backend aggregation, including crash-recovery checkpoints.
const fixtureCatalog: contract.ConnectCatalog = { plans: [{ id: 'cloudlink', entitlements: ['cloudlink'], products: [{ store: 'apple', productId: 'fixture.apple' }, { store: 'google', productId: 'fixture.google', basePlanId: 'monthly', offerIds: ['trial'] }] }] };
const googleProduct = { id: 'fixture.google', platform: 'android', type: 'subs', title: 'Monthly', displayPrice: '$4.99', subscriptionOffers: [
  { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-offer', displayPrice: '$4.99', price: 4.99, period: { unit: 'month', value: 1 } },
  { id: 'trial', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'trial-offer', displayPrice: '$0', price: 0 },
  { id: 'not-advertised', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'bad-offer', displayPrice: '$0', price: 0 },
  { id: 'yearly', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'wrong-base', displayPrice: '$40', price: 40 },
] };
const selected = storeApi.selectConnectOffers(fixtureCatalog, [googleProduct as unknown as ProductSubscription], 'google');
assert.equal(selected.length, 2);
const legacyCatalog = { plans: fixtureCatalog.plans.map((plan) => ({ ...plan, entitlements: ['connect'] })) };
assert.deepEqual(storeApi.selectConnectOffers(legacyCatalog, [googleProduct as unknown as ProductSubscription], 'google'), selected);
assert.equal(storeApi.isConnectPurchase(legacyCatalog, { productId: 'fixture.google', store: 'google' } as Purchase, 'google'), true);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'google' } as Purchase, 'google'), true);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'apple' } as Purchase, 'google'), false);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [], 'google').length, 0);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [{ id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: true } as ProductSubscription], 'apple').length, 0);
const appleProduct = { id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: false, displayPrice: '$4.99', subscriptionOffers: [{ type: 'introductory', displayPrice: '$0', period: { unit: 'week', value: 1 }, periodCount: 1 }] };
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct as unknown as ProductSubscription], 'apple')[0].phases, []);
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct as unknown as ProductSubscription], 'apple', new Set(['fixture.apple']))[0].phases, [{ price: '$0', period: { unit: 'week', value: 1 }, cycles: 1 }]);
const replaced = storeApi.connectPurchaseRequest(selected[0], { productId: 'previous', purchaseToken: 'previous-token' } as Purchase, 'google');
assert.ok(replaced.type === 'subs' && replaced.request.google);
assert.equal(replaced.request.google.purchaseToken, 'previous-token');
assert.deepEqual(replaced.request.google.subscriptionProductReplacementParams, { oldProductId: 'previous', replacementMode: 'deferred' });
assert.equal(storeApi.connectPurchaseRequest({ productId: 'fixture.apple' } as storeApi.ConnectOffer, undefined, 'apple').request.apple!.andDangerouslyFinishTransactionAutomatically, false);
assert.deepEqual(storeApi.AVAILABLE_CONNECT_PURCHASES, { onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false });
assert.deepEqual(storeApi.parseBillingPeriod('P3M'), { value: 3, unit: 'month' });

for (const platform of ['apple', 'google'] as const) {
  device.os = platform === 'apple' ? 'ios' : 'android';
  const phases: any[] = [];
  device.subscriptionEvents = phases;
  const purchase = { id: 'transaction', productId: 'fixture', store: platform, purchaseToken: platform === 'apple' ? 'exact.native.jws' : 'exact-google-token', purchaseState: 'purchased' };
  let claimStatus = 200, claims = 0, finishFails = false;
  const nativeApi = {
    getTransactionJwsIOS: async () => 'fallback.native.jws',
    finishTransaction: async ({ purchase: finished, isConsumable }: any) => {
      phases.push('finish');
      assert.equal(finished, purchase); assert.equal(isConsumable, false);
      assert.ok(Array.from(device.secrets.values()).includes(JSON.stringify(session)), 'Session must already be durable at finalization.');
      if (finishFails) throw new Error('store unavailable');
    },
  };
  globalThis.fetch = async (_url: any, init: any) => {
    phases.push('claim'); claims += 1;
    assert.deepEqual(JSON.parse(init.body), platform === 'apple' ? { store: 'apple', signedTransaction: 'exact.native.jws' } : { store: 'google', purchaseToken: 'exact-google-token' });
    return new Response(JSON.stringify(session), { status: claimStatus });
  };
  const complete = (pending: any) => subscriptionService.finalizeConnectPurchase(pairing.controlPlaneUrl, platform, pending, nativeApi as unknown as storeApi.ConnectStoreApi, () => undefined);
  // Apple finishes the StoreKit transaction in the app. Google acknowledgment is
  // the control plane's durable responsibility, so the app must never finalize it.
  const finalized = platform === 'apple' ? ['claim', 'secure', 'finish'] : ['claim', 'secure'];
  const saved = platform === 'apple' ? ['secure', 'finish'] : ['secure'];
  try {
    await complete({ purchase }); assert.deepEqual(phases, finalized);
    phases.length = 0; claimStatus = 502;
    await assert.rejects(complete({ purchase })); assert.deepEqual(phases, ['claim']);
    phases.length = 0; claimStatus = 200; device.failSecureWrite = true;
    const saving = { purchase };
    await assert.rejects(complete(saving), /secure session saving failed/); assert.deepEqual(phases, ['claim']);
    device.failSecureWrite = false; phases.length = 0;
    await complete(saving); assert.deepEqual(phases, saved);
    phases.length = 0; const previousClaims = claims;
    await complete({ purchase }); assert.equal(claims, previousClaims + 1, 'Restart safely exchanges the rediscovered proof again.');
    phases.length = 0;
    await assert.rejects(complete({ purchase: { ...purchase, purchaseState: 'pending' } }), /pending/); assert.deepEqual(phases, []);
    await assert.rejects(complete({ purchase: { ...purchase, store: platform === 'apple' ? 'google' : 'apple' } }), /different store/); assert.deepEqual(phases, []);
    if (platform === 'apple') {
      phases.length = 0; finishFails = true; const unfinished = { purchase };
      await assert.rejects(complete(unfinished), /store finalization failed/); assert.deepEqual(phases, ['claim', 'secure', 'finish']);
      phases.length = 0; finishFails = false;
      await complete(unfinished); assert.deepEqual(phases, ['finish'], 'Finalization retry must not claim or purchase again.');
    } else {
      phases.length = 0;
      await complete({ purchase });
      assert.deepEqual(phases, ['claim', 'secure'], 'Android must never call finishTransaction.');
    }
  } finally { globalThis.fetch = originalFetch; device.failSecureWrite = false; delete device.subscriptionEvents; }
}

// Run the real provider hook and purchase service on both stores. A failed
// verification must permit automatic routing without replaying a purchase;
// once verified, secure-save/finalization checkpoints must stay in their scope.
for (const platform of ['apple', 'google'] as const) {
  // Google has no client-side finalization failure: the control plane owns
  // acknowledgment with durable retry.
  const scenarios = platform === 'apple'
    ? ['billing-init', 'billing-false', 'billing-catalog', 'billing-purchases', 'catalog', 'routing', 'claim', 'restore', 'secure', 'finish']
    : ['billing-init', 'billing-false', 'billing-catalog', 'billing-purchases', 'catalog', 'routing', 'claim', 'restore', 'secure'];
  for (const scenario of scenarios) {
    // Each scenario represents a fresh app process, including its catalog cache.
    const failure = scenario === 'restore' ? 'claim' : scenario;
    device.os = platform === 'apple' ? 'ios' : 'android';
    device.secrets.clear();
    const staging = 'https://apistaging.opencodecloud.link';
    const purchase: any = { id: 'recovery-transaction', productId: `fixture.${platform}`, store: platform, purchaseState: 'purchased', purchaseToken: 'exact-native-proof', transactionDate: Date.now() };
    if (scenario === 'routing' && platform === 'apple') purchase.environmentIOS = 'Sandbox';
    const requests: any[] = [], events: any[] = [];
    let fail = true, onPurchase: any, onAppState: any, releaseManagement: any, managementCalls = 0;
    const retryConnection = deferred<void>();
    let holdRetry = false;
    let initializationCalls = 0, endCalls = 0, productCalls = 0, availableCalls = 0;
    const nativeApi = {
      initConnection: async () => {
        initializationCalls++;
        if (holdRetry) await retryConnection.promise;
        if (fail && scenario === 'billing-init') throw new Error('Billing client not ready');
        return !(fail && scenario === 'billing-false');
      },
      endConnection: async () => { endCalls++; return true; },
      fetchProducts: async () => {
        productCalls++;
        if (fail && scenario === 'billing-catalog') throw new Error('Billing client not ready');
        return scenario === 'catalog' && fail ? [] : platform === 'apple' ? [appleProduct as unknown as ProductSubscription] : [googleProduct as unknown as ProductSubscription];
      },
      // Recovery must retain the transaction even if the next store query has
      // not published it yet. No interactive Restore is needed to change scope.
      getAvailablePurchases: async () => {
        availableCalls++;
        if (fail && scenario === 'billing-purchases') throw new Error('Billing client not ready');
        return [];
      }, getPendingTransactionsIOS: async () => [],
      requestPurchase: async () => { events.push('purchase'); },
      restorePurchases: async () => { events.push('restore'); },
      getTransactionJwsIOS: async () => '', isEligibleForIntroOfferIOS: async () => false,
      finishTransaction: async ({ purchase: finished }: any) => {
        events.push('finish'); assert.equal(finished, purchase);
        if (fail && failure === 'finish') throw new Error('Store unavailable');
      },
      purchaseUpdatedListener: (listener: any) => { onPurchase = listener; return { remove() {} }; },
      purchaseErrorListener: () => ({ remove() {} }),
    };
    device.billing = {
      ...nativeApi,
      deepLinkToSubscriptions: async () => {
        managementCalls++;
        await new Promise((resolve) => { releaseManagement = resolve; });
      },
    };
    device.appState = (listener) => { onAppState = listener; };
    globalThis.fetch = async (address: any) => {
      requests.push(address);
      const testPurchase = scenario === 'routing' && platform === 'google' && address === `${connect.CONNECT_PRODUCTION_URL}/v1/subscriptions/claim`;
      const status = testPurchase ? 403 : address.endsWith('/claim') && fail && failure === 'claim' ? 400 : 200;
      const response = testPurchase ? { error: 'Google test purchases are disabled in this environment' } : address.endsWith('/catalog') ? fixtureCatalog : address.endsWith('/claim') ? session : { machines: [] };
      return new Response(JSON.stringify(response), { status });
    };
    const runtime = mountConnect(pairing.controlPlaneUrl);
    try {
      await settleReact();
      assert.equal(runtime.result.current.storeInstall, true, 'The provider must expose the resolved store-install flag.');
      if (scenario === 'catalog' || scenario.startsWith('billing-')) {
        assert.equal(runtime.result.current.initialization, 'error');
        assert.equal(runtime.result.current.canPurchase, false, 'Failed initialization must block checkout until recovery completes.');
        assert.equal(initializationCalls, 1);
        if (scenario !== 'billing-purchases') assert.equal(runtime.result.current.offers.length, 0);
        if (['billing-init', 'billing-false'].includes(scenario)) {
          assert.equal(runtime.result.current.storeReady, false);
          assert.equal(productCalls, 0, 'Never query products before billing connects.');
          assert.equal(availableCalls, 0);
        }
        const setupError = runtime.result.current.error;
        assert.match(setupError!, scenario === 'catalog' ? /No matching Cloud Link products/ : scenario === 'billing-false' ? /Could not connect to the native store/ : /Billing client not ready/);
        await invoke(() => onAppState?.('active'));
        await settleReact();
        assert.equal(runtime.result.current.error, setupError, 'Foregrounding must preserve failed setup errors.');
        assert.equal(runtime.result.current.canRetry, true);
        fail = false; holdRetry = true;
        assert.equal(await invoke(() => runtime.result.current.retry()), false, 'Restarted setup completes asynchronously.');
        await settleReact();
        assert.equal(runtime.result.current.storeReady, false);
        assert.equal(runtime.result.current.canPurchase, false);
        assert.equal(await invoke(() => runtime.result.current.retry()), false, 'Do not restart initialization while it is running.');
        await invoke(() => retryConnection.resolve());
        await settleReact();
        assert.equal(initializationCalls, 2, 'Retry must reconnect billing, not just reuse its API.');
        assert.equal(endCalls, 1, 'Remove the failed billing connection before reconnecting.');
        assert.ok(availableCalls > 0, 'Retry must also recover existing purchases.');
        assert.equal(runtime.result.current.initialization, 'ready');
        assert.equal(runtime.result.current.error, undefined);
        assert.equal(runtime.result.current.canRetry, false);
        assert.ok(runtime.result.current.offers.length > 0);
        assert.equal(runtime.result.current.canPurchase, true);
        continue;
      }
      assert.equal(runtime.result.current.canPurchase, true);
      if (scenario === 'routing') {
        assert.equal(runtime.result.current.subscriptionExpiresAt, undefined, 'Do not invent an access date before verification.');
        const management = start(() => runtime.result.current.manageSubscription());
        await settleReact();
        assert.equal(runtime.result.current.busy, true);
        assert.equal(await invoke(() => runtime.result.current.manageSubscription()), false, 'Do not open duplicate store-management sheets.');
        await invoke(() => releaseManagement?.());
        assert.equal(await management, true);
        await settleReact();
        assert.equal(managementCalls, 1);
        await invoke(() => runtime.result.current.pairLink({ v: '1', cp: staging, id: 'discarded', t: 'temporary-proof', n: 'Test Mac' }));
        await settleReact();
        await invoke(() => runtime.result.current.cancelPairing());
        await settleReact();
        assert.equal(await connect.getPendingConnectPairing(staging, platform), undefined, 'Closing must clear the pending QR in its own environment before buyer routing');
      }
      await invoke(() => runtime.result.current.purchase(runtime.result.current.offers[0].key));
      await settleReact();
      assert.equal(await invoke(() => runtime.result.current.manageSubscription()), false, 'Do not open subscription management during a purchase.');
      assert.equal(runtime.result.current.canChangeControlPlane, false, 'An open store purchase cannot change environment');
      device.failSecureWrite = failure === 'secure';
      await invoke(() => onPurchase?.(purchase));
      await settleReact();
      if (scenario === 'routing') {
        assert.equal(runtime.result.current.controlPlaneUrl, staging);
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(runtime.result.current.subscriptionExpiresAt, session.subscription_expires_at, 'Expose the verified access-through date only.');
        assert.equal(runtime.result.current.error, undefined);
        assert.equal(await connect.getConnectSession(pairing.controlPlaneUrl, platform), undefined);
        assert.equal((await connect.getConnectSession(staging, platform))!.user_token, session.user_token);
        assert.deepEqual(requests.filter((address) => address.endsWith('/claim')), platform === 'google'
          ? [`${pairing.controlPlaneUrl}/v1/subscriptions/claim`, `${staging}/v1/subscriptions/claim`]
          : [`${staging}/v1/subscriptions/claim`]);
        assert.deepEqual(events, platform === 'apple' ? ['purchase', 'finish'] : ['purchase']);
        continue;
      }
      assert.equal(runtime.result.current.phase, 'idle', 'A failed operation must not leave a stale progress phase');
      assert.equal(runtime.result.current.canPurchase, false);
      assert.equal(runtime.result.current.canRetry, true);
      const error = runtime.result.current.error;
      assert.ok(error);
      await invoke(() => runtime.result.current.purchase(runtime.result.current.offers[0].key));
      await settleReact();
      assert.equal(runtime.result.current.error, error, 'Another Subscribe action must preserve the actual failure');
      assert.deepEqual(events.filter((event) => event === 'purchase'), ['purchase']);
      assert.equal(runtime.result.current.canChangeControlPlane, failure === 'claim');
      fail = false; device.failSecureWrite = false;
      if (scenario === 'claim') {
        assert.equal(requests.some((address) => address.startsWith(staging)), false, 'An ordinary verification failure must never route to staging');
        await invoke(() => runtime.result.current.retry());
        await settleReact();
        assert.equal(runtime.result.current.controlPlaneUrl, pairing.controlPlaneUrl);
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 2);
      } else if (scenario === 'restore') {
        await invoke(() => runtime.result.current.restore());
        await settleReact();
        assert.equal(runtime.result.current.entitled, true, 'Restore must reuse the retained transaction even when the store query is empty');
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 2);
      } else {
        assert.equal(runtime.result.current.selectControlPlane(staging), false, 'A verified checkpoint must remain in its original environment');
        await invoke(() => runtime.result.current.retry());
        await settleReact();
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 1, 'Saving/finalizing retry must reuse the verified session');
      }
      assert.equal(runtime.result.current.error, undefined);
      assert.equal(runtime.result.current.canChangeControlPlane, true);
      assert.deepEqual(events.filter((event) => event === 'purchase' || event === 'restore'), scenario === 'restore' ? ['purchase', 'restore'] : ['purchase']);
    } finally {
      runtime.unmount(); globalThis.fetch = originalFetch; device.failSecureWrite = false;
    }
  }
}

// Purchase initiation is detached from the shared action lock. The store event
// and the requestPurchase result must both finalize the transaction while the
// native request is still pending, on both store implementations.
for (const platform of ['apple', 'google'] as const) {
  for (const scenario of ['listener', 'result', 'both', 'foreground', 'rejected']) {
    device.os = platform === 'apple' ? 'ios' : 'android';
    device.secrets.clear();
    let request = deferred<any>();
    let requestCalls = 0, claims = 0, finishes = 0, proof: any;
    let onPurchase: any, onAppState: any, published = false;
    const purchase: any = { id: `purchase-${scenario}`, productId: `fixture.${platform}`, store: platform, purchaseState: 'purchased',
      purchaseToken: platform === 'apple' ? 'exact.native.jws' : 'exact-google-token', transactionDate: Date.now(),
      ...(platform === 'google' ? { isAcknowledgedAndroid: false } : {}) };
    const nativeApi = {
      initConnection: async () => true, endConnection: async () => true,
      fetchProducts: async () => platform === 'apple' ? [appleProduct as unknown as ProductSubscription] : [googleProduct as unknown as ProductSubscription],
      getAvailablePurchases: async () => published ? [purchase] : [],
      getPendingTransactionsIOS: async () => published ? [purchase] : [],
      requestPurchase: async () => { requestCalls += 1; return request.promise; },
      restorePurchases: async () => {},
      getTransactionJwsIOS: async () => '', isEligibleForIntroOfferIOS: async () => false,
      finishTransaction: async ({ purchase: finished, isConsumable }: any) => {
        finishes += 1; assert.equal(finished, purchase); assert.equal(isConsumable, false);
      },
      purchaseUpdatedListener: (listener: any) => { onPurchase = listener; return { remove() {} }; },
      purchaseErrorListener: () => ({ remove() {} }),
    };
    device.billing = nativeApi;
    device.appState = (listener) => { onAppState = listener; };
    globalThis.fetch = async (address: any, init: any) => {
      if (address.endsWith('/catalog')) return new Response(JSON.stringify(fixtureCatalog));
      if (address.endsWith('/claim')) {
        claims += 1; proof = init?.body ? JSON.parse(init.body) : undefined;
        return new Response(JSON.stringify(session));
      }
      return new Response(JSON.stringify({ machines: [] }));
    };
    const runtime = mountConnect(pairing.controlPlaneUrl);
    try {
      await settleReact();
      assert.equal(runtime.result.current.canPurchase, true);
      const key = runtime.result.current.offers[0].key;
      const started = start(() => runtime.result.current.purchase(key));
      await settleReact();
      assert.equal(requestCalls, 1);
      assert.equal(runtime.result.current.phase, 'purchasing');
      assert.equal(runtime.result.current.busy, true);
      assert.equal(await invoke(() => runtime.result.current.purchase(key)), false, 'A pending native request blocks duplicate purchase taps');
      assert.equal(requestCalls, 1);
      if (scenario === 'rejected') {
        request.reject(new Error('native store unavailable'));
        assert.equal(await started, false);
        await settleReact();
        assert.equal(runtime.result.current.phase, 'idle');
        assert.equal(runtime.result.current.busy, false);
        assert.equal(runtime.result.current.canRetry, true);
        assert.equal(runtime.result.current.canPurchase, true);
        assert.match(runtime.result.current.error!, /could not start the purchase/);
        assert.equal(claims, 0); assert.equal(finishes, 0);
        request = deferred<any>();
        const retried = start(() => runtime.result.current.purchase(key));
        await settleReact();
        assert.equal(requestCalls, 2, 'A rejected request releases the purchase guard');
        await invoke(() => onPurchase?.(purchase));
        await settleReact();
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(runtime.result.current.phase, 'idle');
        request.resolve(purchase);
        assert.equal(await retried, true);
        await settleReact();
        assert.equal(claims, 1); assert.equal(finishes, platform === 'apple' ? 1 : 0);
        assert.deepEqual(proof, platform === 'apple' ? { store: 'apple', signedTransaction: 'exact.native.jws' } : { store: 'google', purchaseToken: 'exact-google-token' });
        continue;
      }
      if (scenario === 'foreground') {
        published = true;
        await invoke(() => onAppState?.('active'));
        await settleReact();
        assert.equal(claims, 1, 'Foreground recovery finalizes a completed native transaction during purchasing');
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(runtime.result.current.phase, 'idle');
      } else if (scenario === 'listener' || scenario === 'both') {
        await invoke(() => onPurchase?.(purchase));
        await settleReact();
        assert.equal(claims, 1);
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(runtime.result.current.phase, 'idle');
      }
      if (scenario === 'result' || scenario === 'both' || scenario === 'foreground') {
        request.resolve(scenario === 'both' ? [purchase] : purchase);
        assert.equal(await started, true);
        await settleReact();
        assert.equal(claims, 1, scenario === 'result' ? 'The requestPurchase result finalizes without a listener event' : 'The listener event and request result finalize exactly once');
      }
      if (scenario === 'result') {
        await invoke(() => onPurchase?.(purchase));
        await settleReact();
        assert.equal(claims, 1, 'A late listener event cannot finalize a completed transaction again');
      }
      assert.equal(finishes, platform === 'apple' ? 1 : 0, 'Google never finishes the transaction client-side');
      assert.equal(runtime.result.current.error, undefined);
      assert.deepEqual(proof, platform === 'apple' ? { store: 'apple', signedTransaction: 'exact.native.jws' } : { store: 'google', purchaseToken: 'exact-google-token' });
      if (scenario === 'listener') {
        request.resolve(purchase);
        assert.equal(await started, true);
        await settleReact();
        assert.equal(claims, 1);
        assert.equal(finishes, platform === 'apple' ? 1 : 0);
      }
    } finally { runtime.unmount(); globalThis.fetch = originalFetch; }
  }
}

// A cached active session must yield to an authoritative subscription rejection.
// Exercise the real QR continuation and Google's production -> staging routing.
for (const platform of ['apple', 'google'] as const) {
  for (const scenario of ['renewed', 'expired', 'missing', 'rejected-again', 'unrelated-403', 'invalid-qr']) {
    device.os = platform === 'apple' ? 'ios' : 'android';
    device.secrets.clear();
    const staging = connect.CONNECT_STAGING_URL;
    const stale = { ...session, user_token: 'stale-session', entitlements: ['cloudlink', 'connect', 'unrelated'] };
    await connect.saveConnectSession(staging, platform, stale);
    const requests: any[] = [], events: any[] = [];
    const purchase: any = { id: 'renewal', productId: `fixture.${platform}`, store: platform, purchaseState: 'purchased', purchaseToken: 'native-renewal-proof', transactionDate: Date.now() };
    if (platform === 'apple') purchase.environmentIOS = 'Sandbox';
    const nativeApi = {
      initConnection: async () => true, endConnection: async () => true,
      fetchProducts: async () => platform === 'apple' ? [appleProduct as unknown as ProductSubscription] : [googleProduct as unknown as ProductSubscription],
      getAvailablePurchases: async () => scenario === 'missing' ? [] : [purchase],
      getPendingTransactionsIOS: async () => [],
      requestPurchase: async () => { throw new Error('Must not buy again'); },
      restorePurchases: async () => { throw new Error('Must not restore interactively'); },
      finishTransaction: async () => { events.push('finish'); },
      purchaseUpdatedListener: () => ({ remove() {} }), purchaseErrorListener: () => ({ remove() {} }),
    };
    device.billing = nativeApi;
    device.appState = undefined;
    device.onSaveProfile = () => { events.push('save-profile'); };
    globalThis.fetch = async (address: any, init: any) => {
      requests.push({ address, token: init.headers.Authorization });
      let status = 200, body: any = { machines: [] };
      if (address.endsWith('/catalog')) body = fixtureCatalog;
      else if (address.endsWith('/subscriptions/claim')) {
        if (address.startsWith(connect.CONNECT_PRODUCTION_URL) && platform === 'google') {
          status = 403; body = { error: 'Google test purchases are disabled in this environment' };
        } else if (scenario === 'expired') { status = 403; body = { error: 'no active subscription' }; }
        else body = { ...session, entitlements: ['cloudlink', 'unrelated'] };
      } else if (address.endsWith('/pairings/renewal-qr/claim')) {
        if (scenario === 'invalid-qr') { status = 401; body = { error: 'invalid pairing token' }; }
        else if (scenario === 'unrelated-403') { status = 403; body = { error: 'unrelated denial' }; }
        else if (init.headers.Authorization === 'Bearer stale-session' || scenario === 'rejected-again') {
          status = 403; body = { error: 'no active subscription' };
        } else body = claim;
      }
      return new Response(JSON.stringify(body), { status });
    };
    const runtime = mountConnect(staging, { switchConnection: async (settings) => {
        events.push('connect');
        assert.equal(settings.connect?.controlPlaneUrl, staging);
        return { status: 'connected', message: 'Connected' };
      } });
    try {
      await settleReact();
      assert.equal(runtime.result.current.entitled, true);
      await invoke(() => runtime.result.current.pairLink({ v: '1', cp: staging, id: 'renewal-qr', t: 'qr-proof', n: 'Mac' }));
      await settleReact();
      await settleReact();
      const pairRequests = requests.filter(({ address }) => address.includes('/pairings/'));
      const proofRequests = requests.filter(({ address }) => address.endsWith('/subscriptions/claim'));
      if (scenario === 'renewed') {
        assert.equal(runtime.result.current.error, undefined);
        assert.equal(runtime.result.current.phase, 'paired');
        assert.equal(runtime.result.current.controlPlaneUrl, staging);
        assert.deepEqual(pairRequests.map(({ token }) => token), ['Bearer stale-session', 'Bearer user-token']);
        assert.deepEqual(events, platform === 'apple' ? ['finish', 'save-profile', 'connect'] : ['save-profile', 'connect']);
        assert.equal(await connect.getPendingConnectPairing(staging, platform), undefined);
      } else if (scenario === 'unrelated-403' || scenario === 'invalid-qr') {
        assert.equal(proofRequests.length, 0, 'Other denials must not reverify store proofs');
        assert.equal(runtime.result.current.entitled, true);
        assert.equal(pairRequests.length, 1);
      } else {
        assert.equal(runtime.result.current.entitled, false, 'A rejected entitlement must not keep the active banner');
        assert.equal(connect.hasConnectEntitlement(await connect.getConnectSession(staging, platform)), false);
        assert.deepEqual((await connect.getConnectSession(staging, platform))!.entitlements, ['unrelated'], 'Invalidate both aliases while preserving unrelated entitlements.');
        assert.equal(runtime.result.current.hasToken, true, `Keep the identity for machine listing: ${platform}/${scenario} (${runtime.result.current.controlPlaneUrl}, ${runtime.result.current.error})`);
        assert.equal((await connect.getPendingConnectPairing(staging, platform))!.pairingId, 'renewal-qr');
        assert.ok(runtime.result.current.error);
        assert.equal(pairRequests.length, scenario === 'rejected-again' ? 2 : 1, 'Recovery must be bounded');
        assert.equal(events.includes('save-profile'), false);
      }
    } finally { runtime.unmount(); globalThis.fetch = originalFetch; }
  }
}


  }, 120_000);
});
