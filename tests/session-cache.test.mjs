import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// The repo's unit-test pattern (see tests/format.test.mjs): transpile the TS
// source and import it as a data URI. session-cache.ts imports through the
// `@/` alias and AsyncStorage, so each dependency is transpiled as well and
// the specifiers are rewritten to data URIs. AsyncStorage is stubbed because
// the default parameter never runs when a storage object is passed in.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function transpileToDataUri(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return `data:text/javascript,${encodeURIComponent(transpiled)}`;
}

const asyncStorageStubUri = `data:text/javascript,${encodeURIComponent(
  'export default { getItem: async () => { throw new Error("AsyncStorage default used; tests must inject storage."); }, setItem: async () => {}, removeItem: async () => {} };',
)}`;


const storageKeys = await import(await transpileToDataUri('lib/storage-keys.ts'));
const persistenceHydrationUri = await transpileToDataUri('providers/persistence-hydration.ts');
const sessionCacheSource = await readFile(path.join(root, 'providers/session-cache.ts'), 'utf8');
const sessionCacheTranspiled = ts.transpileModule(sessionCacheSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sessionCacheUri = `data:text/javascript,${encodeURIComponent(
  sessionCacheTranspiled
    .replace(/from '@\/lib\/storage-keys'/g, `from "${await transpileToDataUri('lib/storage-keys.ts')}"`)
    .replace(/from '@\/providers\/persistence-hydration'/g, `from "${persistenceHydrationUri}"`)
    .replace(/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`),
)}`;

assert.equal(storageKeys.sessionsCacheKey('/work/a'), 'opencode-mobile.sessions./work/a');
assert.equal(storageKeys.sessionStatusesCacheKey('/work/a'), 'opencode-mobile.session-statuses./work/a');

const { hydrateSessionCache, persistSessionCache } = await import(sessionCacheUri);

function createMemoryStorage(failGetItem = false) {
  const map = new Map();
  return {
    map,
    async getItem(key) {
      if (failGetItem) {
        throw new Error('transient storage failure');
      }
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

const sessionsA = [{ id: 'a-1', title: 'Alpha' }, { id: 'a-2', title: 'Beta' }];
const statusesA = { 'a-1': { type: 'running' } };

// 1. Initial cached hydration applies both keys for the active project.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify(statusesA));
  let appliedSessions = null;
  let appliedStatuses = null;
  await hydrateSessionCache('/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, sessionsA);
  assert.deepEqual(appliedStatuses, statusesA);
}

// 2. Switching A -> B hydrates B's cache only, never A's.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify(statusesA));
  storage.map.set(storageKeys.sessionsCacheKey('/work/b'), JSON.stringify([{ id: 'b-1', title: 'Gamma' }]));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/b'), JSON.stringify({}));
  let appliedSessions = null;
  let appliedStatuses = 'unset';
  await hydrateSessionCache('/work/b', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, [{ id: 'b-1', title: 'Gamma' }]);
  assert.deepEqual(appliedStatuses, {});
}

// 3. A confirmed empty server list persists as empty and clears stale caches.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify(statusesA));
  await persistSessionCache('/work/a', [], {}, storage);
  assert.equal(storage.map.get(storageKeys.sessionsCacheKey('/work/a')), '[]');
  assert.equal(storage.map.get(storageKeys.sessionStatusesCacheKey('/work/a')), '{}');

  let appliedSessions = 'unset';
  let appliedStatuses = 'unset';
  await hydrateSessionCache('/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, []);
  assert.deepEqual(appliedStatuses, {});
}

// 4. Malformed cached values are removed; nothing is applied.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), '{not json');
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), '[1,2]');
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey('/work/a')), false);
}

// 5. Invalid shapes (session without id) are treated as malformed.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify([{ title: 'no id' }]));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), false);
}

// 6. Transient storage read failures leave the key untouched.
{
  const storage = createMemoryStorage(true);
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), true);
}

// 7. Values read for a project the user already switched away from are not applied.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => false, storage);
  assert.equal(applied, false);
  // The valid key survives for the next time the project is opened.
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), true);
}

// 8. persistSessionCache writes whatever the server returned, including non-empty updates.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/b', sessionsA, statusesA, storage);
  assert.equal(storage.map.get(storageKeys.sessionsCacheKey('/work/b')), JSON.stringify(sessionsA));
  assert.equal(storage.map.get(storageKeys.sessionStatusesCacheKey('/work/b')), JSON.stringify(statusesA));
}

console.log('session cache tests passed');
