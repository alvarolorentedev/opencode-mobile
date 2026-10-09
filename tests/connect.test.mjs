import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTs, hookRuntime } from './helpers/runtime.mjs';

const uri = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
async function moduleUri(file, replacements) {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const [pattern, replacement] of replacements) code = code.replace(pattern, replacement);
  return uri(code);
}
globalThis.__connectConfig = { extra: { connectPilot: { enabled: false, controlPlanes: ['https://api.opencodecloud.link', 'http://127.0.0.1:8787'] } } };
globalThis.__connectPlatform = 'ios';
globalThis.__connectSecrets = new Map();
const constants = uri('export default { get expoConfig() { return globalThis.__connectConfig; } };');
const native = uri('export const Platform = { get OS() { return globalThis.__connectPlatform; } };');
const secure = uri(`export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1;
  export async function getItemAsync(key) { return globalThis.__connectSecrets.get(key) ?? null; }
  export async function setItemAsync(key, value) { if (globalThis.__secureWriteFails) throw new Error('secure write failed'); globalThis.__subscriptionEvents?.push('secure'); globalThis.__connectSecrets.set(key, value); }
  export async function deleteItemAsync(key) { globalThis.__connectSecrets.delete(key); }`);
const connect = await import(await moduleUri('../lib/connect.ts', [
  [/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`],
]));
const tunnelRetryDelays = [];
const access = await loadTs('providers/connect/access.ts', {
  'react-native': { Platform: { OS: 'ios' } },
  '@/lib/connect': {},
  '@/providers/connection-refresh': {},
  '@/lib/connection-profiles': { getProfilePassword: async () => 'device-secret' },
  '@/providers/services/connect-subscription-service': {},
  '@/providers/connect/catalog': {},
}, {
  setTimeout(callback, delay) { tunnelRetryDelays.push(delay); callback(); return tunnelRetryDelays.length; },
  clearTimeout() {},
});
const connectionErrors = await loadTs('lib/opencode/client/errors.ts', {
  './url': { normalizeServerUrl: (serverUrl) => ({ valid: true, displayUrl: serverUrl }) },
}, { Error });
const tunnelHtmlError = new Error('<html><meta content="text/html">Cloudflare Error 1033</html>');
assert.match(connectionErrors.getConnectionError('https://machine.example.test', tunnelHtmlError), /1033/);
assert.equal(new connect.ConnectApiError(403, { error: 'Google test purchases are disabled in this environment' }).testPurchase, true);
assert.equal(new connect.ConnectApiError(403, { error: 'no active subscription' }).testPurchase, false);
assert.equal(new connect.ConnectApiError(502, { error: 'Google test purchases are disabled in this environment' }).testPurchase, false);
assert.equal(new connect.ConnectApiError(403, { error: 'no active subscription' }).noActiveSubscription, true);
assert.equal(new connect.ConnectApiError(403, { error: 'another denial' }).noActiveSubscription, false);
assert.equal(new connect.ConnectApiError(502, { error: 'no active subscription' }).noActiveSubscription, false);
assert.match(new connect.ConnectApiError(403, { code: 'capacity_reached' }).message, /provisioning is pending/);
assert.equal(new connect.ConnectApiError(403, { code: 'capacity_reached' }).noActiveSubscription, false);
assert.doesNotMatch(new connect.ConnectApiError(403, { error: 'another denial' }).message, /No active Cloud Link entitlement/);
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
  assert.match(connect.getConnectCredentialError(legacyMetadata, 'legacy-secret'), /trusted/);
  await assert.rejects(connect.getConnectSession(legacyControlPlane, 'apple'), /trusted/);
  const legacySegment = Array.from(legacyControlPlane).map((char) => char.charCodeAt(0).toString(16)).join('-');
  for (const kind of ['session', 'pairing']) {
    const key = `opencode-mobile.connect-${kind}.apple.${legacySegment}`;
    const value = JSON.stringify({ legacy: kind });
    legacySecrets.set(key, value);
    globalThis.__connectSecrets.set(key, value);
  }
}
for (const controlPlane of connect.getConnectControlPlanes()) {
  assert.equal(await connect.getConnectSession(controlPlane, 'apple'), undefined, 'New environments do not reuse legacy sessions.');
  assert.equal(await connect.getPendingConnectPairing(controlPlane, 'apple'), undefined, 'New environments do not reuse legacy QR records.');
}
for (const [key, value] of legacySecrets) assert.equal(globalThis.__connectSecrets.get(key), value, 'Legacy secure records remain untouched.');
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
assert.equal((await connect.getConnectSession(customControlPlane, 'apple')).user_token, 'staging-token');
assert.equal((await connect.getConnectSession(pairing.controlPlaneUrl, 'apple')).user_token, 'user-token');
await connect.savePendingConnectPairing(customControlPlane, 'apple', customPairing);
assert.deepEqual(await connect.getPendingConnectPairing(customControlPlane, 'apple'), customPairing);
assert.equal(await connect.getPendingConnectPairing(pairing.controlPlaneUrl, 'apple'), undefined);

const calls = [];
const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'Machine', device_id: 'device-1', device_secret: 'signed-credential', expires_at: new Date(Date.now() + 60_000).toISOString() };
let status = 200, response = claim;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address, init) => { calls.push({ address, init }); return new Response(status === 204 ? null : JSON.stringify(response), { status }); };
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
    await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'), (error) => error.status === expected && !error.message.includes('signed-credential'));
  }
  status = 200;
  for (const invalid of [{ ...claim, device_secret: undefined }, { ...claim, expires_at: 'bad' }, { ...claim, expires_at: '2000-01-01T00:00:00Z' }, { ...claim, server_url: 'http://m.example.test' }, { ...claim, server_url: 'https://user:secret@m.example.test' }]) {
    response = invalid; await assert.rejects(connect.claimConnectPairing(pairing, 'user-token', 'Phone'));
  }
  response = { machines: [{ id: 'machine-1', name: 'Machine', hostname: 'm.example.test', public_url: claim.server_url, created_at: '2026-10-02T00:00:00Z', access_enabled: true }] };
  assert.equal((await connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'))[0].id, 'machine-1');
  response = claim;
  assert.equal((await connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token')).machine_id, 'machine-1');
  response = { ...claim, machine_id: 'other-machine' };
  await assert.rejects(connect.accessConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token'), /machine_identity_mismatch/);
  response = { ...session, acknowledgement_pending: true };
  assert.deepEqual(await connect.claimConnectSubscription(pairing.controlPlaneUrl, { store: 'apple', signedTransaction: 'native.jws.proof' }), session);
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { store: 'apple', signedTransaction: 'native.jws.proof' });
  assert.ok(!calls.at(-1).address.includes('native.jws.proof'));
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
  const catalogs = await Promise.all([1, 2].map(() => connect.getConnectCatalog(pairing.controlPlaneUrl)));
  assert.deepEqual(catalogs[0], catalog);
  assert.equal(calls.length, beforeCatalog + 1, 'Concurrent catalog reads share one request.');
  catalogs[0].plans.length = 0;
  assert.deepEqual(await connect.getConnectCatalog(pairing.controlPlaneUrl), catalog);
  assert.equal(calls.length, beforeCatalog + 1, 'Cached catalog is protected from consumer mutation.');
  await connect.getConnectCatalog(customControlPlane);
  assert.equal(calls.length, beforeCatalog + 2, 'Production and staging catalogs are separate.');
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  response = { plans: [catalog.plans[0], catalog.plans[0]] };
  const originalNow = Date.now;
  try {
    const expired = originalNow() + 5 * 60_000 + 1;
    Date.now = () => expired;
    await assert.rejects(connect.getConnectCatalog(pairing.controlPlaneUrl), /Ambiguous/);
    response = catalog;
    assert.deepEqual(await connect.getConnectCatalog(pairing.controlPlaneUrl), catalog, 'Failed refreshes can be retried.');
  } finally { Date.now = originalNow; }
  assert.equal(new connect.ConnectApiError(409, { machine_id: 'machine-1' }).machineId, 'machine-1');
  assert.equal(new connect.ConnectApiError(503, { machine_id: 'machine-1' }).machineId, 'machine-1');
  status = 204;
  await connect.revokeConnectMachine(pairing.controlPlaneUrl, 'machine-1', 'user-token');
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(calls.at(-1).address, 'https://api.opencodecloud.link/v1/machines/machine-1');
  const count = calls.length;
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, ''), (error) => error.status === 401);
  globalThis.__connectPlatform = 'web';
  await assert.rejects(connect.listConnectMachines(pairing.controlPlaneUrl, 'user-token'), /iOS and Android/);
  assert.throws(() => connect.parseConnectPairing(url.toString()), /iOS and Android/);
  assert.equal(calls.length, count, 'Missing authentication and unsupported platforms must not make account requests.');
  globalThis.__connectPlatform = 'ios';
} finally { globalThis.fetch = originalFetch; }

// Verify native upgrades add Basic without putting credentials in the URL;
// browser upgrades retain the existing ticket-only behavior.
const service = await import(await moduleUri('../providers/services/terminal-service.ts', [
  [/from 'react-native'/g, `from "${native}"`],
  [/from '@\/lib\/opencode\/client'/g, `from "${uri('export function buildPtyWebSocketUrl() {}')}"`],
  [/from '@\/providers\/services\/require-data'/g, `from "${uri('export function requireData(value) { return value; }')}"`],
]));
const originalSocket = globalThis.WebSocket;
globalThis.WebSocket = class { constructor(...args) { this.args = args; } };
try {
  const socket = service.openTerminalWebSocket('wss://m.example.test/pty/1/connect?ticket=upstream', 'Basic device-credential');
  assert.equal(socket.args[0], 'wss://m.example.test/pty/1/connect?ticket=upstream');
  assert.deepEqual(socket.args[2], { headers: { Authorization: 'Basic device-credential' } });
  globalThis.__connectPlatform = 'web';
  assert.equal(connect.isConnectEnabled(), false);
  assert.deepEqual(service.openTerminalWebSocket('ws://local/pty?ticket=x', 'Basic secret').args, ['ws://local/pty?ticket=x']);
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), '');
  globalThis.__connectConfig.extra.e2eMode = true;
  globalThis.__connectConfig.extra.connectPilot.testing = true;
  connect.setConnectTestSecret('secret', 'value');
  assert.equal(connect.getConnectTestSecret('secret'), 'value');
} finally { globalThis.WebSocket = originalSocket; }

const configSource = await readFile(new URL('../app.config.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function appConfig(variant, controlPlaneUrl) {
  const context = { exports: {}, require: createRequire(import.meta.url), process: { env: { EXPO_APP_VARIANT: variant, EXPO_PUBLIC_E2E_MODE: '1', EXPO_CONNECT_CONTROL_PLANE_URL: controlPlaneUrl, EXPO_CONNECT_CONTROL_PLANES: 'http://127.0.0.1:8787', EXPO_CONNECT_TEST_USER_TOKEN: 'configured-test-token' } } };
  vm.runInNewContext(compiled, context);
  return context.exports.default;
}
const production = appConfig('production'), development = appConfig('development');
assert.equal(production.extra.connectControlPlaneUrl, undefined);
assert.equal(development.extra.connectControlPlaneUrl, undefined);
globalThis.__connectConfig = appConfig('production', `${customControlPlane}/`);
assert.deepEqual(connect.getConnectControlPlanes(), [connect.CONNECT_PRODUCTION_URL, connect.CONNECT_STAGING_URL]);
globalThis.__connectConfig = appConfig('production', 'http://localhost:8787');
assert.deepEqual(connect.getConnectControlPlanes(), [connect.CONNECT_PRODUCTION_URL, connect.CONNECT_STAGING_URL]);
assert.equal(production.extra.connectPilot.enabled, undefined);
assert.equal(production.extra.connectPilot.controlPlanes, undefined);
assert.equal(production.extra.connectPilot.testUserToken, undefined);
assert.equal(development.extra.connectPilot.testUserToken, undefined);
assert.equal(development.extra.connectPilot.controlPlanes, undefined);
assert.notEqual(production.ios.bundleIdentifier, development.ios.bundleIdentifier);
assert.notEqual(production.android.package, development.android.package);
for (const config of [production, development]) {
  assert.ok(config.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera'), 'Every native build needs camera permission configuration.');
  globalThis.__connectConfig = config;
  for (const platform of ['ios', 'android']) {
    globalThis.__connectPlatform = platform;
    assert.equal(connect.isConnectEnabled(), true);
    assert.deepEqual(connect.parseConnectPairing(url.toString()), pairing);
  }
}

// The FOSS (F-Droid) variant disables Cloud Link and drops the proprietary
// Play Billing / ML Kit barcode plugins.
const foss = appConfig('foss');
assert.equal(foss.extra.foss, true);
assert.equal(foss.android.package, 'app.getopencode.fdroid');
assert.ok(!foss.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera'), 'FOSS build must not configure the camera/ML Kit plugin.');
assert.ok(!foss.plugins.includes('expo-iap'), 'FOSS build must not configure the Play Billing plugin.');
{
  const savedConfig = globalThis.__connectConfig;
  const savedPlatform = globalThis.__connectPlatform;
  globalThis.__connectConfig = { extra: { foss: true } };
  globalThis.__connectPlatform = 'android';
  assert.equal(connect.isConnectEnabled(), false, 'FOSS builds must disable Cloud Link.');
  globalThis.__connectConfig = savedConfig;
  globalThis.__connectPlatform = savedPlatform;
}
// Gradle regenerates Expo configuration; it must use the same variant as
// prebuild, even when the caller has a conflicting variant in the environment.
for (const variant of ['development', 'production']) {
  const file = variant === 'development' ? 'build-android-development' : 'build-android-release';
  const source = (await readFile(new URL(`../scripts/${file}.mjs`, import.meta.url), 'utf8')).replace(/^#!.*\n/, '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true, esModuleInterop: true } }).outputText;
  const commands = [];
  const environment = { EXPO_APP_VARIANT: variant === 'development' ? 'production' : 'development', ANDROID_KEYSTORE_PATH: '/fake/store', ANDROID_KEYSTORE_PASSWORD: 'test', ANDROID_KEY_ALIAS: 'test', ANDROID_KEY_PASSWORD: 'test' };
  const actualRequire = createRequire(import.meta.url);
  await vm.runInNewContext(`(async () => { ${code} })()`, {
    exports: {}, Buffer,
    process: { env: environment, cwd: () => '/fake/project', exit: () => { throw new Error('Build script failed'); } },
    console: { log() {}, warn() {}, error() {} },
    require: (name) => name === 'node:child_process' ? {
      spawnSync(command, args, options) { commands.push({ command, env: options?.env ?? environment }); return { status: 0, stdout: 'Alias name: test\n' }; },
    } : name === 'node:fs' ? {
      existsSync: () => true, copyFileSync() {}, statSync: () => ({ size: 128 }), readFileSync: () => Buffer.alloc(128),
    } : actualRequire(name),
  });
  const nativeCommands = commands.filter(({ command }) => command === 'npx' || command === './gradlew');
  assert.deepEqual(nativeCommands.map(({ command }) => command), ['npx', './gradlew']);
  for (const command of nativeCommands) assert.equal(command.env.EXPO_APP_VARIANT, variant);
}
console.log('Connect parser, API, credentials, native availability, camera config, build variants, and WebSocket tests passed');

// Test the actual store/backend aggregation, including crash-recovery checkpoints.
const storeUri = await moduleUri('../lib/connect-store.ts', [
  [/from '@\/lib\/connect'/g, `from "${await moduleUri('../lib/connect.ts', [[/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`], [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`]])}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`],
]);
const storeApi = await import(storeUri);
const connectUri = await moduleUri('../lib/connect.ts', [
  [/from 'expo\/fetch'/g, `from "${uri('export const fetch = (...args) => globalThis.fetch(...args);')}"`],
  [/from 'expo-constants'/g, `from "${constants}"`], [/from 'react-native'/g, `from "${native}"`], [/from 'expo-secure-store'/g, `from "${secure}"`],
]);
const subscriptionService = await import(await moduleUri('../providers/services/connect-subscription-service.ts', [
  [/from '@\/lib\/connect'/g, `from "${connectUri}"`], [/from '@\/lib\/connect-store'/g, `from "${storeUri}"`],
]));
const fixtureCatalog = { plans: [{ id: 'cloudlink', entitlements: ['cloudlink'], products: [{ store: 'apple', productId: 'fixture.apple' }, { store: 'google', productId: 'fixture.google', basePlanId: 'monthly', offerIds: ['trial'] }] }] };
const googleProduct = { id: 'fixture.google', platform: 'android', type: 'subs', title: 'Monthly', displayPrice: '$4.99', subscriptionOffers: [
  { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-offer', displayPrice: '$4.99', price: 4.99, period: { unit: 'month', value: 1 } },
  { id: 'trial', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'trial-offer', displayPrice: '$0', price: 0 },
  { id: 'not-advertised', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'bad-offer', displayPrice: '$0', price: 0 },
  { id: 'yearly', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'wrong-base', displayPrice: '$40', price: 40 },
] };
const selected = storeApi.selectConnectOffers(fixtureCatalog, [googleProduct], 'google');
assert.equal(selected.length, 2);
const legacyCatalog = { plans: fixtureCatalog.plans.map((plan) => ({ ...plan, entitlements: ['connect'] })) };
assert.deepEqual(storeApi.selectConnectOffers(legacyCatalog, [googleProduct], 'google'), selected);
assert.equal(storeApi.isConnectPurchase(legacyCatalog, { productId: 'fixture.google', store: 'google' }, 'google'), true);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'google' }, 'google'), true);
assert.equal(storeApi.isConnectPurchase(fixtureCatalog, { productId: 'fixture.google', store: 'apple' }, 'google'), false);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [], 'google').length, 0);
assert.equal(storeApi.selectConnectOffers(fixtureCatalog, [{ id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: true }], 'apple').length, 0);
const appleProduct = { id: 'fixture.apple', type: 'subs', platform: 'ios', isFamilyShareableIOS: false, displayPrice: '$4.99', subscriptionOffers: [{ type: 'introductory', displayPrice: '$0', period: { unit: 'week', value: 1 }, periodCount: 1 }] };
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct], 'apple')[0].phases, []);
assert.deepEqual(storeApi.selectConnectOffers(fixtureCatalog, [appleProduct], 'apple', new Set(['fixture.apple']))[0].phases, [{ price: '$0', period: { unit: 'week', value: 1 }, cycles: 1 }]);
const replaced = storeApi.connectPurchaseRequest(selected[0], { productId: 'previous', purchaseToken: 'previous-token' }, 'google');
assert.equal(replaced.request.google.purchaseToken, 'previous-token');
assert.deepEqual(replaced.request.google.subscriptionProductReplacementParams, { oldProductId: 'previous', replacementMode: 'deferred' });
assert.equal(storeApi.connectPurchaseRequest({ productId: 'fixture.apple' }, undefined, 'apple').request.apple.andDangerouslyFinishTransactionAutomatically, false);
assert.deepEqual(storeApi.AVAILABLE_CONNECT_PURCHASES, { onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false });
assert.deepEqual(storeApi.parseBillingPeriod('P3M'), { value: 3, unit: 'month' });

for (const platform of ['apple', 'google']) {
  globalThis.__connectPlatform = platform === 'apple' ? 'ios' : 'android';
  const phases = [];
  globalThis.__subscriptionEvents = phases;
  const purchase = { id: 'transaction', productId: 'fixture', store: platform, purchaseToken: platform === 'apple' ? 'exact.native.jws' : 'exact-google-token', purchaseState: 'purchased' };
  let claimStatus = 200, claims = 0, finishFails = false;
  const nativeApi = {
    getTransactionJwsIOS: async () => 'fallback.native.jws',
    finishTransaction: async ({ purchase: finished, isConsumable }) => {
      phases.push('finish');
      assert.equal(finished, purchase); assert.equal(isConsumable, false);
      assert.ok(Array.from(globalThis.__connectSecrets.values()).includes(JSON.stringify(session)), 'Session must already be durable at finalization.');
      if (finishFails) throw new Error('store unavailable');
    },
  };
  globalThis.fetch = async (_url, init) => {
    phases.push('claim'); claims += 1;
    assert.deepEqual(JSON.parse(init.body), platform === 'apple' ? { store: 'apple', signedTransaction: 'exact.native.jws' } : { store: 'google', purchaseToken: 'exact-google-token' });
    return new Response(JSON.stringify(session), { status: claimStatus });
  };
  const complete = (pending) => subscriptionService.finalizeConnectPurchase(pairing.controlPlaneUrl, platform, pending, nativeApi, () => undefined);
  try {
    await complete({ purchase }); assert.deepEqual(phases, ['claim', 'secure', 'finish']);
    phases.length = 0; claimStatus = 502;
    await assert.rejects(complete({ purchase })); assert.deepEqual(phases, ['claim']);
    phases.length = 0; claimStatus = 200; globalThis.__secureWriteFails = true;
    const saving = { purchase };
    await assert.rejects(complete(saving), /secure session saving failed/); assert.deepEqual(phases, ['claim']);
    globalThis.__secureWriteFails = false; phases.length = 0;
    await complete(saving); assert.deepEqual(phases, ['secure', 'finish']);
    phases.length = 0; finishFails = true; const unfinished = { purchase };
    await assert.rejects(complete(unfinished), /store finalization failed/); assert.deepEqual(phases, ['claim', 'secure', 'finish']);
    phases.length = 0; finishFails = false;
    await complete(unfinished); assert.deepEqual(phases, ['finish'], 'Finalization retry must not claim or purchase again.');
    phases.length = 0; const previousClaims = claims;
    await complete({ purchase }); assert.equal(claims, previousClaims + 1, 'Restart safely exchanges the rediscovered proof again.');
    phases.length = 0;
    await assert.rejects(complete({ purchase: { ...purchase, purchaseState: 'pending' } }), /pending/); assert.deepEqual(phases, []);
    await assert.rejects(complete({ purchase: { ...purchase, store: platform === 'apple' ? 'google' : 'apple' } }), /different store/); assert.deepEqual(phases, []);
  } finally { globalThis.fetch = originalFetch; globalThis.__secureWriteFails = false; delete globalThis.__subscriptionEvents; }
}
console.log('Subscription catalog, native proof, DEFERRED replacement, secure grant/finalization and recovery checks passed');

// Run the real provider hook and purchase service on both stores. A failed
// verification must permit automatic routing without replaying a purchase;
// once verified, secure-save/finalization checkpoints must stay in their scope.
for (const platform of ['apple', 'google']) {
  for (const scenario of ['catalog', 'routing', 'claim', 'restore', 'secure', 'finish']) {
    // Each scenario represents a fresh app process, including its catalog cache.
    const freshConnectUri = `${connectUri}#${platform}-${scenario}`;
    const connect = await import(freshConnectUri);
    const subscriptionService = await import(await moduleUri('../providers/services/connect-subscription-service.ts', [
      [/from '@\/lib\/connect'/g, `from "${freshConnectUri}"`],
      [/from '@\/lib\/connect-store'/g, `from "${storeUri}"`],
    ]));
    const failure = scenario === 'restore' ? 'claim' : scenario;
    globalThis.__connectPlatform = platform === 'apple' ? 'ios' : 'android';
    globalThis.__connectSecrets.clear();
    const runtime = hookRuntime();
    const staging = 'https://apistaging.opencodecloud.link';
    const purchase = { id: 'recovery-transaction', productId: `fixture.${platform}`, store: platform, purchaseState: 'purchased', purchaseToken: 'exact-native-proof', transactionDate: Date.now() };
    if (scenario === 'routing' && platform === 'apple') purchase.environmentIOS = 'Sandbox';
    const requests = [], events = [];
    let fail = true, onPurchase, onAppState, releaseManagement, managementCalls = 0;
    const nativeApi = {
      initConnection: async () => true, endConnection: async () => true,
      fetchProducts: async () => scenario === 'catalog' && fail ? [] : platform === 'apple' ? [appleProduct] : [googleProduct],
      // Recovery must retain the transaction even if the next store query has
      // not published it yet. No interactive Restore is needed to change scope.
      getAvailablePurchases: async () => [], getPendingTransactionsIOS: async () => [],
      requestPurchase: async () => { events.push('purchase'); },
      restorePurchases: async () => { events.push('restore'); },
      getTransactionJwsIOS: async () => '', isEligibleForIntroOfferIOS: async () => false,
      finishTransaction: async ({ purchase: finished }) => {
        events.push('finish'); assert.equal(finished, purchase);
        if (fail && failure === 'finish') throw new Error('Store unavailable');
      },
      purchaseUpdatedListener: (listener) => { onPurchase = listener; return { remove() {} }; },
      purchaseErrorListener: () => ({ remove() {} }),
    };
    const concern = {
      'react-native': { Platform: { OS: globalThis.__connectPlatform }, AppState: { addEventListener: (_, listener) => { onAppState = listener; return { remove() {} }; } } },
      '@/lib/connect': connect,
      '@/lib/connect-store': { ...storeApi, loadConnectStore: async () => nativeApi,
        openConnectSubscriptionManagement: async () => { managementCalls++; await new Promise((resolve) => { releaseManagement = resolve; }); },
      },
      '@/lib/connection-profiles': { loadConnectionProfiles: async () => [] },
      '@/providers/connection-refresh': {},
      '@/providers/services/connect-subscription-service': subscriptionService,
    };
    const catalogModule = await loadTs('providers/connect/catalog.ts', concern, { Error });
    const purchasesModule = await loadTs('providers/connect/purchases.ts', concern);
    const pairingModule = await loadTs('providers/connect/pairing.ts', concern);
    const accessModule = await loadTs('providers/connect/access.ts', concern);
    const hook = await loadTs('providers/connect/use-connect-machine.ts', {
      ...concern,
      react: runtime.react,
      '@/providers/connect/catalog': catalogModule,
      '@/providers/connect/purchases': purchasesModule,
      '@/providers/connect/pairing': pairingModule,
      '@/providers/connect/access': accessModule,
    }, { Error });
    globalThis.fetch = async (address) => {
      requests.push(address);
      const testPurchase = scenario === 'routing' && platform === 'google' && address === `${connect.CONNECT_PRODUCTION_URL}/v1/subscriptions/claim`;
      const status = testPurchase ? 403 : address.endsWith('/claim') && fail && failure === 'claim' ? 400 : 200;
      const response = testPurchase ? { error: 'Google test purchases are disabled in this environment' } : address.endsWith('/catalog') ? fixtureCatalog : address.endsWith('/claim') ? session : { machines: [] };
      return new Response(JSON.stringify(response), { status });
    };
    try {
      runtime.mount(() => {
        const [controlPlaneUrl, setControlPlaneUrl] = runtime.react.useState(pairing.controlPlaneUrl);
        return hook.useConnectState({ controlPlaneUrl, setControlPlaneUrl, isHydrated: true,
          switchConnection: async () => ({ status: 'connected' }), disconnect: async () => {},
          beforeProfileRefresh: async () => {}, onProfileRefreshed: () => {},
        });
      }, {});
      await runtime.settle();
      if (scenario === 'catalog') {
        assert.equal(runtime.value.initialization, 'error');
        assert.equal(runtime.value.offers.length, 0);
        const setupError = runtime.value.error;
        assert.match(setupError, /No matching Cloud Link products/);
        onAppState('active');
        await runtime.settle();
        assert.equal(runtime.value.error, setupError, 'Foregrounding must preserve failed setup errors.');
        assert.equal(runtime.value.canRetry, true);
        fail = false;
        assert.equal(await runtime.value.retry(), true);
        await runtime.settle();
        assert.equal(runtime.value.initialization, 'ready');
        assert.equal(runtime.value.error, undefined);
        assert.equal(runtime.value.canRetry, false);
        assert.ok(runtime.value.offers.length > 0);
        assert.equal(runtime.value.canPurchase, true);
        continue;
      }
      assert.equal(runtime.value.canPurchase, true);
      if (scenario === 'routing') {
        assert.equal(runtime.value.subscriptionExpiresAt, undefined, 'Do not invent an access date before verification.');
        const management = runtime.value.manageSubscription();
        await runtime.settle();
        assert.equal(runtime.value.busy, true);
        assert.equal(await runtime.value.manageSubscription(), false, 'Do not open duplicate store-management sheets.');
        releaseManagement();
        assert.equal(await management, true);
        await runtime.settle();
        assert.equal(managementCalls, 1);
        await runtime.value.pairLink({ v: '1', cp: staging, id: 'discarded', t: 'temporary-proof', n: 'Test Mac' });
        await runtime.settle();
        await runtime.value.cancelPairing();
        await runtime.settle();
        assert.equal(await connect.getPendingConnectPairing(staging, platform), undefined, 'Closing must clear the pending QR in its own environment before buyer routing');
      }
      await runtime.value.purchase(runtime.value.offers[0].key);
      await runtime.settle();
      assert.equal(await runtime.value.manageSubscription(), false, 'Do not open subscription management during a purchase.');
      assert.equal(runtime.value.canChangeControlPlane, false, 'An open store purchase cannot change environment');
      globalThis.__secureWriteFails = failure === 'secure';
      onPurchase(purchase);
      await runtime.settle();
      if (scenario === 'routing') {
        assert.equal(runtime.value.controlPlaneUrl, staging);
        assert.equal(runtime.value.entitled, true);
        assert.equal(runtime.value.subscriptionExpiresAt, session.subscription_expires_at, 'Expose the verified access-through date only.');
        assert.equal(runtime.value.error, undefined);
        assert.equal(await connect.getConnectSession(pairing.controlPlaneUrl, platform), undefined);
        assert.equal((await connect.getConnectSession(staging, platform)).user_token, session.user_token);
        assert.deepEqual(requests.filter((address) => address.endsWith('/claim')), platform === 'google'
          ? [`${pairing.controlPlaneUrl}/v1/subscriptions/claim`, `${staging}/v1/subscriptions/claim`]
          : [`${staging}/v1/subscriptions/claim`]);
        assert.deepEqual(events, ['purchase', 'finish']);
        continue;
      }
      assert.equal(runtime.value.phase, 'idle', 'A failed operation must not leave a stale progress phase');
      assert.equal(runtime.value.canPurchase, false);
      assert.equal(runtime.value.canRetry, true);
      const error = runtime.value.error;
      assert.ok(error);
      await runtime.value.purchase(runtime.value.offers[0].key);
      await runtime.settle();
      assert.equal(runtime.value.error, error, 'Another Subscribe action must preserve the actual failure');
      assert.deepEqual(events.filter((event) => event === 'purchase'), ['purchase']);
      assert.equal(runtime.value.canChangeControlPlane, failure === 'claim');
      fail = false; globalThis.__secureWriteFails = false;
      if (scenario === 'claim') {
        assert.equal(requests.some((address) => address.startsWith(staging)), false, 'An ordinary verification failure must never route to staging');
        await runtime.value.retry();
        await runtime.settle();
        assert.equal(runtime.value.controlPlaneUrl, pairing.controlPlaneUrl);
        assert.equal(runtime.value.entitled, true);
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 2);
      } else if (scenario === 'restore') {
        await runtime.value.restore();
        await runtime.settle();
        assert.equal(runtime.value.entitled, true, 'Restore must reuse the retained transaction even when the store query is empty');
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 2);
      } else {
        assert.equal(runtime.value.selectControlPlane(staging), false, 'A verified checkpoint must remain in its original environment');
        await runtime.value.retry();
        await runtime.settle();
        assert.equal(runtime.value.entitled, true);
        assert.equal(requests.filter((address) => address.endsWith('/claim')).length, 1, 'Saving/finalizing retry must reuse the verified session');
      }
      assert.equal(runtime.value.error, undefined);
      assert.equal(runtime.value.canChangeControlPlane, true);
      assert.deepEqual(events.filter((event) => event === 'purchase' || event === 'restore'), scenario === 'restore' ? ['purchase', 'restore'] : ['purchase']);
    } finally {
      runtime.unmount(); globalThis.fetch = originalFetch; globalThis.__secureWriteFails = false;
    }
  }
}
console.log('Apple/Google provider environment correction, checkpoint isolation, and duplicate-purchase recovery checks passed');

// A cached active session must yield to an authoritative subscription rejection.
// Exercise the real QR continuation and Google's production -> staging routing.
for (const platform of ['apple', 'google']) {
  for (const scenario of ['renewed', 'expired', 'missing', 'rejected-again', 'unrelated-403', 'invalid-qr']) {
    const freshConnectUri = `${connectUri}#${platform}-${scenario}`;
    const connect = await import(freshConnectUri);
    const subscriptionService = await import(await moduleUri('../providers/services/connect-subscription-service.ts', [
      [/from '@\/lib\/connect'/g, `from "${freshConnectUri}"`],
      [/from '@\/lib\/connect-store'/g, `from "${storeUri}"`],
    ]));
    globalThis.__connectPlatform = platform === 'apple' ? 'ios' : 'android';
    globalThis.__connectSecrets.clear();
    const staging = connect.CONNECT_STAGING_URL;
    const stale = { ...session, user_token: 'stale-session', entitlements: ['cloudlink', 'connect', 'unrelated'] };
    await connect.saveConnectSession(staging, platform, stale);
    const runtime = hookRuntime();
    const requests = [], events = [];
    const purchase = { id: 'renewal', productId: `fixture.${platform}`, store: platform, purchaseState: 'purchased', purchaseToken: 'native-renewal-proof', transactionDate: Date.now() };
    if (platform === 'apple') purchase.environmentIOS = 'Sandbox';
    const nativeApi = {
      initConnection: async () => true, endConnection: async () => true,
      fetchProducts: async () => platform === 'apple' ? [appleProduct] : [googleProduct],
      getAvailablePurchases: async () => scenario === 'missing' ? [] : [purchase],
      getPendingTransactionsIOS: async () => [],
      requestPurchase: async () => { throw new Error('Must not buy again'); },
      restorePurchases: async () => { throw new Error('Must not restore interactively'); },
      finishTransaction: async () => { events.push('finish'); },
      purchaseUpdatedListener: () => ({ remove() {} }), purchaseErrorListener: () => ({ remove() {} }),
    };
    const concern = {
      'react-native': { Platform: { OS: globalThis.__connectPlatform }, AppState: { addEventListener: () => ({ remove() {} }) } },
      '@/lib/connect': connect,
      '@/lib/connect-store': { ...storeApi, loadConnectStore: async () => nativeApi },
      '@/lib/connection-profiles': { loadConnectionProfiles: async () => [], saveConnectProfile: async (cp, response) => {
        events.push('save-profile'); assert.equal(cp, staging);
        return { id: 'saved', serverUrl: response.server_url, connect: { machineId: response.machine_id } };
      }, getProfilePassword: async () => 'device-secret' },
      '@/providers/connection-refresh': {},
      '@/providers/services/connect-subscription-service': subscriptionService,
    };
    const catalogModule = await loadTs('providers/connect/catalog.ts', concern);
    const purchasesModule = await loadTs('providers/connect/purchases.ts', concern);
    const pairingModule = await loadTs('providers/connect/pairing.ts', concern);
    const accessModule = await loadTs('providers/connect/access.ts', concern);
    const hook = await loadTs('providers/connect/use-connect-machine.ts', {
      ...concern,
      react: runtime.react,
      '@/providers/connect/catalog': catalogModule,
      '@/providers/connect/purchases': purchasesModule,
      '@/providers/connect/pairing': pairingModule,
      '@/providers/connect/access': accessModule,
    });
    globalThis.fetch = async (address, init) => {
      requests.push({ address, token: init.headers.Authorization });
      let status = 200, body = { machines: [] };
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
    try {
      runtime.mount(() => {
        const [controlPlaneUrl, setControlPlaneUrl] = runtime.react.useState(staging);
        return hook.useConnectState({ controlPlaneUrl, setControlPlaneUrl, isHydrated: true,
          switchConnection: async () => { events.push('connect'); return { status: 'connected' }; },
          disconnect: async () => {}, beforeProfileRefresh: async () => {}, onProfileRefreshed: () => {},
        });
      }, {});
      await runtime.settle();
      assert.equal(runtime.value.entitled, true);
      await runtime.value.pairLink({ v: '1', cp: staging, id: 'renewal-qr', t: 'qr-proof', n: 'Mac' });
      await runtime.settle();
      await runtime.settle();
      const pairRequests = requests.filter(({ address }) => address.includes('/pairings/'));
      const proofRequests = requests.filter(({ address }) => address.endsWith('/subscriptions/claim'));
      if (scenario === 'renewed') {
        assert.equal(runtime.value.error, undefined);
        assert.equal(runtime.value.phase, 'paired');
        assert.equal(runtime.value.controlPlaneUrl, staging);
        assert.deepEqual(pairRequests.map(({ token }) => token), ['Bearer stale-session', 'Bearer user-token']);
        assert.deepEqual(events, ['finish', 'save-profile', 'connect']);
        assert.equal(await connect.getPendingConnectPairing(staging, platform), undefined);
      } else if (scenario === 'unrelated-403' || scenario === 'invalid-qr') {
        assert.equal(proofRequests.length, 0, 'Other denials must not reverify store proofs');
        assert.equal(runtime.value.entitled, true);
        assert.equal(pairRequests.length, 1);
      } else {
        assert.equal(runtime.value.entitled, false, 'A rejected entitlement must not keep the active banner');
        assert.equal(connect.hasConnectEntitlement(await connect.getConnectSession(staging, platform)), false);
        assert.deepEqual((await connect.getConnectSession(staging, platform)).entitlements, ['unrelated'], 'Invalidate both aliases while preserving unrelated entitlements.');
        assert.equal(runtime.value.hasToken, true, `Keep the identity for machine listing: ${platform}/${scenario} (${runtime.value.controlPlaneUrl}, ${runtime.value.error})`);
        assert.equal((await connect.getPendingConnectPairing(staging, platform)).pairingId, 'renewal-qr');
        assert.ok(runtime.value.error);
        assert.equal(pairRequests.length, scenario === 'rejected-again' ? 2 : 1, 'Recovery must be bounded');
        assert.equal(events.includes('save-profile'), false);
      }
    } finally { runtime.unmount(); globalThis.fetch = originalFetch; }
  }
}
console.log('Apple/Android stale entitlement recovery, QR preservation, and bounded retries passed');

const connectProfile = { id: 'cloud-machine', serverUrl: 'https://machine.example.test', username: 'device', connect: { machineId: 'machine-1' } };
let connectionAttempts = 0;
const phases = [];
await access.activateConnectProfile({
  setSavedProfile() {},
  setPhase: (phase) => phases.push(phase),
  switchConnection: async () => ++connectionAttempts < 3
    ? { status: 'error', message: '<html>Cloudflare Error 1033</html>' }
    : { status: 'connected', message: 'Connected' },
}, connectProfile);
assert.equal(connectionAttempts, 3);
assert.deepEqual(tunnelRetryDelays.splice(0), [1_000, 2_000]);
assert.deepEqual(phases, ['connecting', 'paired']);

connectionAttempts = 0;
await assert.rejects(access.activateConnectProfile({
  setSavedProfile() {},
  setPhase() {},
  switchConnection: async () => { connectionAttempts += 1; return { status: 'error', message: 'The Cloudflare tunnel is still starting (Error 1033).' }; },
}, connectProfile), /1033/);
assert.equal(connectionAttempts, 5, 'Cloud Link readiness retries stop after the 15-second backoff window.');
assert.deepEqual(tunnelRetryDelays.splice(0), [1_000, 2_000, 4_000, 8_000]);

connectionAttempts = 0;
await assert.rejects(access.activateConnectProfile({
  setSavedProfile() {},
  setPhase() {},
  switchConnection: async () => { connectionAttempts += 1; return { status: 'error', message: 'Cloudflare Error 1033' }; },
}, { ...connectProfile, connect: undefined }), /1033/);
assert.equal(connectionAttempts, 1, 'Manual connections do not receive Cloud Link tunnel retries.');
console.log('Cloud Link tunnel startup retries only Cloudflare 1033 and leaves manual connections unchanged');
