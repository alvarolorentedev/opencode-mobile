import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Same transport as tests/session-cache.test.mjs: transpile TS and import via
// data URIs, rewriting the `@/` alias. favorites-storage.ts only value-imports
// FAVORITE_SESSIONS_MAX from the (type-only) provider-types module; the scope
// values come from the production connection-scope helper.

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

const base64Uri = `data:text/javascript,${encodeURIComponent(
  `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
)}`;
const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
  [/from 'base-64'/g, `from "${base64Uri}"`],
]);
const { getConnectionScope } = await import(connectionScopeUri);

const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

const providerTypesUri = await transpileToDataUri('providers/opencode-provider-types.ts');
const favoritesSource = await readFile(path.join(root, 'providers/favorites-storage.ts'), 'utf8');
const favoritesTranspiled = ts.transpileModule(favoritesSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const favoritesUri = `data:text/javascript,${encodeURIComponent(
  favoritesTranspiled.replace(/from '@\/providers\/opencode-provider-types'/g, `from "${providerTypesUri}"`),
)}`;

const { parseFavoriteSessions, serializeFavoriteSessions } = await import(favoritesUri);
const providerTypes = await import(providerTypesUri);
const MAX = providerTypes.FAVORITE_SESSIONS_MAX;

// 1. Valid hydration maps to the explicit model and strips unknown/legacy
// fields such as `projectLabel`.
{
  const raw = JSON.stringify([
    {
      sessionId: 's1',
      connectionScope: scopeA,
      projectPath: '/work/a',
      projectLabel: 'a',
      title: 'Alpha',
      favoritedAt: 10,
      password: 'leaked',
    },
    { sessionId: 's2', connectionScope: scopeA, projectPath: '/work/b', favoritedAt: 20 },
  ]);
  assert.deepEqual(parseFavoriteSessions(raw), [
    { sessionId: 's1', connectionScope: scopeA, projectPath: '/work/a', title: 'Alpha', favoritedAt: 10 },
    { sessionId: 's2', connectionScope: scopeA, projectPath: '/work/b', favoritedAt: 20 },
  ]);
  assert.equal(JSON.stringify(parseFavoriteSessions(raw)).includes('leaked'), false);
}

// 2. Malformed entries are discarded individually; valid ones survive.
{
  const raw = JSON.stringify([
    { sessionId: 'ok', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
    { sessionId: '', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
    { sessionId: 'no-path', connectionScope: scopeA, projectPath: '', favoritedAt: 1 },
    { sessionId: 'no-time', connectionScope: scopeA, projectPath: '/work/a' },
    { sessionId: 'bad-time', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 'yesterday' },
    { sessionId: 'bad-title', connectionScope: scopeA, projectPath: '/work/a', title: 42, favoritedAt: 1 },
    { sessionId: 'bad-scope', connectionScope: '', projectPath: '/work/a', favoritedAt: 1 },
    'not-an-object',
    null,
  ]);
  assert.deepEqual(parseFavoriteSessions(raw), [
    { sessionId: 'ok', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
  ]);
}

// 3. Favorites persisted before multi-server support carry no connection scope,
// so they are dropped instead of being attributed to whichever server happens
// to be active.
{
  const legacy = JSON.stringify([
    { sessionId: 'old-1', projectPath: '/work/a', title: 'Legacy', favoritedAt: 1 },
    { sessionId: 'old-2', projectPath: '/work/a', favoritedAt: 2 },
  ]);
  assert.deepEqual(parseFavoriteSessions(legacy), []);
}

// 4. Identical project paths and session IDs on two servers stay independent.
{
  const raw = JSON.stringify([
    { sessionId: 'shared', connectionScope: scopeA, projectPath: '/srv/same', title: 'A copy', favoritedAt: 1 },
    { sessionId: 'shared', connectionScope: scopeB, projectPath: '/srv/same', title: 'B copy', favoritedAt: 2 },
  ]);
  const parsed = parseFavoriteSessions(raw);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((favorite) => favorite.connectionScope).sort(), [scopeA, scopeB].sort());
  assert.deepEqual(parsed.map((favorite) => favorite.title).sort(), ['A copy', 'B copy']);
}

// 5. The maximum is enforced on hydration, so a corrupt value cannot hydrate an
// unbounded list.
{
  const raw = JSON.stringify(
    Array.from({ length: MAX + 25 }, (_, index) => ({
      sessionId: `s${index}`,
      connectionScope: scopeA,
      projectPath: '/work/a',
      favoritedAt: index,
    })),
  );
  const parsed = parseFavoriteSessions(raw);
  assert.equal(parsed.length, MAX);
  assert.equal(parsed[0].sessionId, 's0');
  assert.equal(parsed[MAX - 1].sessionId, `s${MAX - 1}`);
}

// 6. A non-array payload is rejected so the loader removes the key.
{
  assert.throws(() => parseFavoriteSessions('{"sessionId":"s1"}'));
  assert.throws(() => parseFavoriteSessions('{not json'));
}

// 7. Serialized output is capped and only contains the explicit model fields.
{
  const oversized = Array.from({ length: MAX + 5 }, (_, index) => ({
    sessionId: `s${index}`,
    connectionScope: scopeA,
    projectPath: '/work/a',
    title: `T${index}`,
    projectLabel: 'legacy',
    password: 'leaked',
    favoritedAt: index,
  }));
  const serialized = JSON.parse(serializeFavoriteSessions(oversized));
  assert.equal(serialized.length, MAX);
  assert.deepEqual(Object.keys(serialized[0]).sort(), ['connectionScope', 'favoritedAt', 'projectPath', 'sessionId', 'title']);
  assert.equal(serializeFavoriteSessions(oversized).includes('leaked'), false);

  // Legacy entries cannot be serialized back either.
  assert.deepEqual(JSON.parse(serializeFavoriteSessions([
    { sessionId: 'old', projectPath: '/work/a', favoritedAt: 1 },
  ])), []);
}

console.log('favorites storage tests passed');
