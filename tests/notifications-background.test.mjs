import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Drives the real background monitor callback from lib/notifications.ts with
// stubbed Expo/AsyncStorage/network modules. The scenario under test:
//
//   Task running on Server A -> user switches to Server B -> monitor runs
//
// A's pending record must remain valid, A's own credentials must be used, and
// another server's password must never be borrowed.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function transpileToDataUri(relativePath, replacements = []) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  let transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  for (const [pattern, replacement] of replacements) {
    transpiled = transpiled.replace(pattern, replacement);
  }
  return `data:text/javascript,${encodeURIComponent(transpiled)}`;
}

globalThis.__notificationsTestAsyncStorage = new Map();
globalThis.__notificationsTestScheduled = [];
globalThis.__notificationsTestBuilds = [];
globalThis.__notificationsTestResolutions = [];
globalThis.__notificationsTestResolver = () => undefined;
globalThis.__notificationsTestClientFactory = () => ({ session: {} });
globalThis.__notificationsTestTask = undefined;

const asyncStorageStubUri = `data:text/javascript,${encodeURIComponent(`
  export default {
    async getItem(key) { return globalThis.__notificationsTestAsyncStorage.has(key) ? globalThis.__notificationsTestAsyncStorage.get(key) : null; },
    async setItem(key, value) { globalThis.__notificationsTestAsyncStorage.set(key, value); },
    async removeItem(key) { globalThis.__notificationsTestAsyncStorage.delete(key); },
  };
`)}`;
const taskManagerStubUri = `data:text/javascript,${encodeURIComponent(`
  export function isTaskDefined() { return false; }
  export function defineTask(name, task) { globalThis.__notificationsTestTask = task; }
  export async function isTaskRegisteredAsync() { return false; }
`)}`;
const backgroundTaskStubUri = `data:text/javascript,${encodeURIComponent(`
  export const BackgroundTaskStatus = { Available: 1, Restricted: 2, Denied: 3 };
  export const BackgroundTaskResult = { Success: 1, Failed: 2 };
  export async function getStatusAsync() { return 1; }
  export async function registerTaskAsync() {}
`)}`;
const notificationsStubUri = `data:text/javascript,${encodeURIComponent(`
  export const AndroidImportance = { DEFAULT: 3 };
  export function setNotificationHandler() {}
  export async function setNotificationChannelAsync() {}
  export async function scheduleNotificationAsync(request) { globalThis.__notificationsTestScheduled.push(request); return 'notification-id'; }
  export async function getPermissionsAsync() { return { granted: true, status: 'granted', canAskAgain: true }; }
  export async function requestPermissionsAsync() { return { granted: true, status: 'granted', canAskAgain: true }; }
`)}`;
const constantsStubUri = `data:text/javascript,${encodeURIComponent(`
  export default { appOwnership: 'standalone' };
`)}`;
const reactNativeStubUri = `data:text/javascript,${encodeURIComponent(`
  export const Platform = { OS: 'android' };
`)}`;
const clientStubUri = `data:text/javascript,${encodeURIComponent(`
  export function buildClient(settings, contract) {
    globalThis.__notificationsTestBuilds.push({ settings, contract });
    return globalThis.__notificationsTestClientFactory(settings);
  }
  export async function detectServerContract() { return { contract: 'v1' }; }
`)}`;
const connectionProfilesStubUri = `data:text/javascript,${encodeURIComponent(`
  export async function resolveConnectionPassword(identity) {
    globalThis.__notificationsTestResolutions.push(identity);
    return globalThis.__notificationsTestResolver(identity);
  }
`)}`;

const base64Uri = `data:text/javascript,${encodeURIComponent(
  `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
)}`;
const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
  [/from 'base-64'/g, `from "${base64Uri}"`],
]);
const storageKeysUri = await transpileToDataUri('lib/storage-keys.ts');
const notificationPendingUri = await transpileToDataUri('lib/notification-pending.ts', [
  [/from '@\/lib\/connection-scope'/g, `from "${connectionScopeUri}"`],
]);
const notificationsUri = await transpileToDataUri('lib/notifications.ts', [
  [/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`],
  [/from 'expo-background-task'/g, `from "${backgroundTaskStubUri}"`],
  [/from 'expo-constants'/g, `from "${constantsStubUri}"`],
  [/from 'expo-notifications'/g, `from "${notificationsStubUri}"`],
  [/from 'expo-task-manager'/g, `from "${taskManagerStubUri}"`],
  [/from 'react-native'/g, `from "${reactNativeStubUri}"`],
  [/from '@\/lib\/connection-profiles'/g, `from "${connectionProfilesStubUri}"`],
  [/from '@\/lib\/opencode\/client'/g, `from "${clientStubUri}"`],
  [/from '@\/lib\/notification-pending'/g, `from "${notificationPendingUri}"`],
  [/from '@\/lib\/storage-keys'/g, `from "${storageKeysUri}"`],
]);

await import(notificationsUri);
const storageKeys = await import(storageKeysUri);
const { getConnectionScope } = await import(connectionScopeUri);
const { pendingNotificationKey } = await import(notificationPendingUri);

const storage = globalThis.__notificationsTestAsyncStorage;
const runTask = globalThis.__notificationsTestTask;
assert.equal(typeof runTask, 'function', 'background task should be registered at import time');

const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

function seedPending() {
  storage.set(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify({
    [pendingNotificationKey(scopeA, 'session-a')]: {
      sessionId: 'session-a',
      projectPath: '/repo',
      connectionScope: scopeA,
      settings: { serverUrl: 'https://a.example', username: 'alice' },
      requestedAt: 1,
    },
    [pendingNotificationKey(scopeB, 'session-b')]: {
      sessionId: 'session-b',
      sessionTitle: 'B task',
      projectPath: '/repo',
      connectionScope: scopeB,
      settings: { serverUrl: 'https://b.example', username: 'alice' },
      requestedAt: 2,
    },
  }));
}

function readPending() {
  const raw = storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

// 1. Server A's task is still running, so its record stays valid, A's own
// credentials are used for its server call, and B's finished task notifies and
// clears only B's record.
{
  globalThis.__notificationsTestAsyncStorage.clear();
  globalThis.__notificationsTestScheduled.length = 0;
  globalThis.__notificationsTestBuilds.length = 0;
  globalThis.__notificationsTestResolutions.length = 0;
  seedPending();

  // A resolves from its saved profile; B resolves from the active connection.
  globalThis.__notificationsTestResolver = ({ serverUrl }) => (
    serverUrl.includes('a.example') ? 'secret-a' : 'secret-b'
  );
  globalThis.__notificationsTestClientFactory = (settings) => ({
    session: {
      status: async () => ({ data: { 'session-a': { type: 'busy' }, 'session-b': { type: 'idle' } } }),
      list: async () => ({ data: [{ id: 'session-a', title: 'A task' }, { id: 'session-b', title: 'B task' }] }),
    },
  });

  assert.equal(await runTask(), 1);

  const pending = readPending();
  assert.equal(Object.keys(pending).length, 1);
  assert.ok(pending[pendingNotificationKey(scopeA, 'session-a')], 'A stays pending while its task runs');
  assert.equal(Boolean(pending[pendingNotificationKey(scopeB, 'session-b')]), false, 'B clears after notifying');

  assert.equal(globalThis.__notificationsTestScheduled.length, 1);
  assert.equal(globalThis.__notificationsTestScheduled[0].content.body, 'B task');

  const aBuild = globalThis.__notificationsTestBuilds.find(({ settings }) => settings.serverUrl.includes('a.example'));
  assert.equal(aBuild.settings.password, 'secret-a');
  assert.equal(aBuild.settings.directory, '/repo');
  const bBuild = globalThis.__notificationsTestBuilds.find(({ settings }) => settings.serverUrl.includes('b.example'));
  assert.equal(bBuild.settings.password, 'secret-b');
}

// 2. When A's credential cannot be resolved (for example the user switched
// away from an unsaved connection), the monitor must keep A's record and must
// not fall back to B's password.
{
  globalThis.__notificationsTestAsyncStorage.clear();
  globalThis.__notificationsTestScheduled.length = 0;
  globalThis.__notificationsTestBuilds.length = 0;
  globalThis.__notificationsTestResolutions.length = 0;
  seedPending();

  globalThis.__notificationsTestResolver = ({ serverUrl }) => (
    serverUrl.includes('a.example') ? undefined : 'secret-b'
  );

  assert.equal(await runTask(), 1);

  const pending = readPending();
  assert.ok(pending[pendingNotificationKey(scopeA, 'session-a')], 'unresolvable A stays pending for a later run');
  assert.equal(Boolean(pending[pendingNotificationKey(scopeB, 'session-b')]), false);
  assert.deepEqual(
    globalThis.__notificationsTestResolutions.map(({ serverUrl }) => serverUrl).sort(),
    ['https://a.example', 'https://b.example'],
  );
  assert.equal(
    globalThis.__notificationsTestBuilds.some(({ settings }) => settings.serverUrl.includes('a.example')),
    false,
    'A is not queried without A credentials',
  );

  // No password is ever serialized into the pending-notification storage.
  const raw = storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
  assert.equal(raw.includes('secret-a'), false);
  assert.equal(raw.includes('secret-b'), false);
}

console.log('notification background tests passed');
