import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const asyncStorageStubUri = `data:text/javascript,${encodeURIComponent(
  'export default { getItem: async () => { throw new Error("AsyncStorage default used; tests must inject storage."); }, setItem: async () => {}, removeItem: async () => {} };',
)}`;

const base64Uri = `data:text/javascript,${encodeURIComponent(
  `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
)}`;
const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
  [/from 'base-64'/g, `from "${base64Uri}"`],
]);
const { getConnectionScope } = await import(connectionScopeUri);

// Two servers exposing the same project paths, which is the case the cache
// scoping exists for. The scope values are produced by the production helper.
const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

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

// Keys embed the connection scope before the project path, so two servers with
// the same path never read or write the same entry.
assert.equal(storageKeys.sessionsCacheKey(scopeA, '/work/a'), `opencode-mobile.sessions.${scopeA}./work/a`);
assert.equal(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'), `opencode-mobile.session-statuses.${scopeA}./work/a`);
assert.notEqual(storageKeys.sessionsCacheKey(scopeA, '/work/a'), storageKeys.sessionsCacheKey(scopeB, '/work/a'));

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
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  let appliedSessions = null;
  let appliedStatuses = null;
  await hydrateSessionCache(scopeA, '/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, mappedSessionsA);
  assert.deepEqual(appliedStatuses, statusesA);
}

// 2. A persisted payload only contains the DTO fields; upstream fields such as
// share URLs, model, directory, and slug are never written.
{
  const storage = createMemoryStorage();
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  const envelope = readEnvelope(storage, storageKeys.sessionsCacheKey(scopeA, '/work/a'));
  assert.equal(typeof envelope.cachedAt, 'number');
  assert.deepEqual(Object.keys(envelope.sessions[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);
  assert.deepEqual(envelope.sessions[0], { id: 'a-1', title: 'Alpha', createdAt: 100, updatedAt: 200 });
  assert.equal(JSON.stringify(envelope).includes('share.example'), false);
  assert.equal(JSON.stringify(envelope).includes('/work/a'), false);
  const statusEnvelope = readEnvelope(storage, storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'));
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
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  await persistSessionCache(scopeB, '/work/b', [{ id: 'b-1', title: 'Gamma', time: { created: 1, updated: 2 } }], {}, storage);
  let appliedSessions = null;
  let appliedStatuses = 'unset';
  await hydrateSessionCache(scopeB, '/work/b', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, [{ id: 'b-1', title: 'Gamma', time: { created: 1, updated: 2 } }]);
  assert.deepEqual(appliedStatuses, {});
}

// 5. A confirmed empty server list persists as empty and clears stale caches.
{
  const storage = createMemoryStorage();
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  await persistSessionCache(scopeA, '/work/a', [], {}, storage);
  assert.deepEqual(readEnvelope(storage, storageKeys.sessionsCacheKey(scopeA, '/work/a')).sessions, []);
  assert.deepEqual(readEnvelope(storage, storageKeys.sessionStatusesCacheKey(scopeA, '/work/a')).statuses, {});

  let appliedSessions = 'unset';
  let appliedStatuses = 'unset';
  await hydrateSessionCache(scopeA, '/work/a', (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions, []);
  assert.deepEqual(appliedStatuses, {});
}

// 6. Malformed cached values are removed; nothing is applied.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey(scopeA, '/work/a'), '{not json');
  storage.map.set(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'), '[1,2]');
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a')), false);
}

// 7. Invalid shapes (session without id, unknown status type) are malformed.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey(scopeA, '/work/a'), JSON.stringify({ cachedAt: Date.now(), sessions: [{ title: 'no id' }] }));
  storage.map.set(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'), JSON.stringify({ cachedAt: Date.now(), statuses: { s1: { type: 'running' } } }));
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a')), false);
}

// 8. Transient storage read failures leave the key untouched.
{
  const storage = createMemoryStorage(true);
  storage.map.set(storageKeys.sessionsCacheKey(scopeA, '/work/a'), JSON.stringify({ cachedAt: Date.now(), sessions: [] }));
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), true);
}

// 9. Values read for a project the user already switched away from are not applied.
{
  const storage = createMemoryStorage();
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => false, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), true);
}

// 10. Cache older than the TTL is discarded and removed.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey(scopeA, '/work/a'), JSON.stringify({ cachedAt: Date.now() - SESSION_CACHE_TTL_MS - 1, sessions: sessionsA }));
  storage.map.set(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'), JSON.stringify({ cachedAt: Date.now() - SESSION_CACHE_TTL_MS - 1, statuses: statusesA }));
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a')), false);
}

// 11. Legacy pre-envelope payloads (plain array / plain map) fail safe and are
// removed rather than crashing; the next fetch republishes them.
{
  const storage = createMemoryStorage();
  storage.map.set(storageKeys.sessionsCacheKey(scopeA, '/work/a'), JSON.stringify(sessionsA));
  storage.map.set(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a'), JSON.stringify(statusesA));
  let applied = false;
  await hydrateSessionCache(scopeA, '/work/a', () => (applied = true), () => (applied = true), () => true, storage);
  assert.equal(applied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, '/work/a')), false);
  assert.equal(storage.map.has(storageKeys.sessionStatusesCacheKey(scopeA, '/work/a')), false);
}

// 12. Write failures are swallowed so server-backed operation continues.
{
  const storage = createMemoryStorage(false, true);
  await persistSessionCache(scopeA, '/work/a', sessionsA, statusesA, storage);
  assert.equal(storage.map.size, 0);
}

// 13. Two servers exposing the same project path keep independent caches, and a
// read whose connection guard went stale is never applied.
{
  const storage = createMemoryStorage();
  const projectPath = '/srv/same/project';
  const serverASessions = [{ id: 'a-1', title: 'Server A session', time: { created: 1, updated: 2 } }];
  const serverBSessions = [{ id: 'b-1', title: 'Server B session', time: { created: 3, updated: 4 } }];
  await persistSessionCache(scopeA, projectPath, serverASessions, { 'a-1': { type: 'busy' } }, storage);
  await persistSessionCache(scopeB, projectPath, serverBSessions, { 'b-1': { type: 'idle' } }, storage);

  let appliedSessions = null;
  let appliedStatuses = null;
  await hydrateSessionCache(scopeB, projectPath, (s) => (appliedSessions = s), (s) => (appliedStatuses = s), () => true, storage);
  assert.deepEqual(appliedSessions.map((session) => session.id), ['b-1']);
  assert.deepEqual(appliedStatuses, { 'b-1': { type: 'idle' } });

  // Still connected to B: A's cache read must not reach B's state even though
  // the project path matches.
  let staleApplied = false;
  await hydrateSessionCache(scopeA, projectPath, () => (staleApplied = true), () => (staleApplied = true), () => false, storage);
  assert.equal(staleApplied, false);
  assert.equal(storage.map.has(storageKeys.sessionsCacheKey(scopeA, projectPath)), true);
}

console.log('session cache tests passed');
