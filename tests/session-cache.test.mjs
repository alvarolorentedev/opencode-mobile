import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// The repo's unit-test pattern (see tests/format.test.mjs): transpile the TS
// source and import it as a data URI. session-cache.ts imports through the
// `@/` alias and AsyncStorage, so each dependency is transpiled as well and
// the specifiers are rewritten to data URIs. AsyncStorage is stubbed because
// the default parameter never runs when a storage object is passed in. The
// `@/lib/opencode/types` import is type-only and erased at transpile time.

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

const { hydrateSessionCache, persistSessionCache, SESSION_CACHE_TTL_MS, toCachedSession } = await import(sessionCacheUri);

function createMemoryStorage(failGetItem = false, failSetItem = false) {
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
      if (failSetItem) {
        throw new Error('transient storage failure');
      }
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

function readEnvelope(storage, key) {
  return JSON.parse(storage.map.get(key));
}

// Full-shaped server sessions: only the DTO subset may survive a write.
const sessionsA = [
  {
    id: 'a-1',
    title: 'Alpha',
    slug: 'alpha',
    projectID: 'p1',
    directory: '/work/a',
    version: '1.0.0',
    share: { url: 'https://share.example/secret' },
    model: { id: 'm', providerID: 'p' },
    time: { created: 100, updated: 200 },
  },
  { id: 'a-2', title: 'Beta', time: { created: 300, updated: 400 } },
];
const statusesA = { 'a-1': { type: 'busy' } };

const mappedSessionsA = [
  { id: 'a-1', title: 'Alpha', time: { created: 100, updated: 200 } },
  { id: 'a-2', title: 'Beta', time: { created: 300, updated: 400 } },
];

// 1. Initial cached hydration applies both keys for the active project.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  let appliedSessions = null;
  let appliedStatuses = null;
  await hydrateSessionCache('/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, mappedSessionsA);
  assert.deepEqual(appliedStatuses, statusesA);
}

// 2. A persisted payload only contains the DTO fields; upstream fields such as
// share URLs, model, directory, and slug are never written.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  const envelope = readEnvelope(storage, storageKeys.sessionsCacheKey('/work/a'));
  assert.equal(typeof envelope.cachedAt, 'number');
  assert.deepEqual(Object.keys(envelope.sessions[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);
  assert.deepEqual(envelope.sessions[0], { id: 'a-1', title: 'Alpha', createdAt: 100, updatedAt: 200 });
  assert.equal(JSON.stringify(envelope).includes('share.example'), false);
  assert.equal(JSON.stringify(envelope).includes('/work/a'), false);
  const statusEnvelope = readEnvelope(storage, storageKeys.sessionStatusesCacheKey('/work/a'));
  assert.deepEqual(statusEnvelope.statuses, { 'a-1': { type: 'busy' } });
}

// 3. toCachedSession ignores non-string titles and non-finite timestamps.
{
  assert.deepEqual(toCachedSession({ id: 'x', title: 5, time: { created: Number.NaN, updated: undefined } }), {
    id: 'x',
    title: '',
    createdAt: 0,
    updatedAt: 0,
  });
}

// 4. Switching A -> B hydrates B's cache only, never A's.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  await persistSessionCache('/work/b', [{ id: 'b-1', title: 'Gamma', time: { created: 1, updated: 2 } }], {}, storage);
  let appliedSessions = null;
  let appliedStatuses = 'unset';
  await hydrateSessionCache('/work/b', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, [{ id: 'b-1', title: 'Gamma', time: { created: 1, updated: 2 } }]);
  assert.deepEqual(appliedStatuses, {});
}

// 5. A confirmed empty server list persists as empty and clears stale caches.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  await persistSessionCache('/work/a', [], {}, storage);
  assert.deepEqual(readEnvelope(storage, storageKeys.sessionsCacheKey('/work/a')).sessions, []);
  assert.deepEqual(readEnvelope(storage, storageKeys.sessionStatusesCacheKey('/work/a')).statuses, {});

  let appliedSessions = 'unset';
  let appliedStatuses = 'unset';
  await hydrateSessionCache('/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, []);
  assert.deepEqual(appliedStatuses, {});
}

// 6. Malformed cached values are removed; nothing is applied.
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

// 7. Invalid shapes (session without id, unknown status type) are malformed.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify({ cachedAt: Date.now(), sessions: [{ title: 'no id' }] }));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify({ cachedAt: Date.now(), statuses: { s1: { type: 'running' } } }));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey('/work/a')), false);
}

// 8. Transient storage read failures leave the key untouched.
{
  const storage = createMemoryStorage(true);
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify({ cachedAt: Date.now(), sessions: [] }));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), true);
}

// 9. Values read for a project the user already switched away from are not applied.
{
  const storage = createMemoryStorage();
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => false, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), true);
}

// 10. Cache older than the TTL is discarded and removed.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify({ cachedAt: Date.now() - SESSION_CACHE_TTL_MS - 1, sessions: sessionsA }));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify({ cachedAt: Date.now() - SESSION_CACHE_TTL_MS - 1, statuses: statusesA }));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey('/work/a')), false);
}

// 11. Legacy pre-envelope payloads (plain array / plain map) fail safe and are
// removed rather than crashing; the next fetch republishes them.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey('/work/a'), JSON.stringify(sessionsA));
  storage.map.set(storageKeys.sessionStatusesCacheKey('/work/a'), JSON.stringify(statusesA));
  let applied = false;
  await hydrateSessionCache('/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey('/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey('/work/a')), false);
}

// 12. Write failures are swallowed so server-backed operation continues.
{
  const storage = createMemoryStorage(false, true);
  await persistSessionCache('/work/a', sessionsA, statusesA, storage);
  assert.equal(storage.map.size, 0);
}

console.log('session cache tests passed');
