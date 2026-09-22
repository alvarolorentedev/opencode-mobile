import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Same transport as tests/session-cache.test.mjs: transpile TS and import via
// data URIs, rewriting the `@/` alias. favorites-storage.ts only value-imports
// FAVORITE_SESSIONS_MAX from the (type-only) provider-types module.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function transpileToDataUri(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return `data:text/javascript,${encodeURIComponent(transpiled)}`;
}

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
    { sessionId: 's1', projectPath: '/work/a', projectLabel: 'a', title: 'Alpha', favoritedAt: 10 },
    { sessionId: 's2', projectPath: '/work/b', favoritedAt: 20 },
  ]);
  assert.deepEqual(parseFavoriteSessions(raw), [
    { sessionId: 's1', projectPath: '/work/a', title: 'Alpha', favoritedAt: 10 },
    { sessionId: 's2', projectPath: '/work/b', favoritedAt: 20 },
  ]);
}

// 2. Malformed entries are discarded individually; valid ones survive.
{
  const raw = JSON.stringify([
    { sessionId: 'ok', projectPath: '/work/a', favoritedAt: 1 },
    { sessionId: '', projectPath: '/work/a', favoritedAt: 1 },
    { sessionId: 'no-path', projectPath: '', favoritedAt: 1 },
    { sessionId: 'no-time', projectPath: '/work/a' },
    { sessionId: 'bad-time', projectPath: '/work/a', favoritedAt: 'yesterday' },
    { sessionId: 'bad-title', projectPath: '/work/a', title: 42, favoritedAt: 1 },
    'not-an-object',
    null,
  ]);
  assert.deepEqual(parseFavoriteSessions(raw), [{ sessionId: 'ok', projectPath: '/work/a', favoritedAt: 1 }]);
}

// 3. The maximum is enforced on hydration, so a corrupt value cannot hydrate an
// unbounded list.
{
  const raw = JSON.stringify(
    Array.from({ length: MAX + 25 }, (_, index) => ({ sessionId: `s${index}`, projectPath: '/work/a', favoritedAt: index })),
  );
  const parsed = parseFavoriteSessions(raw);
  assert.equal(parsed.length, MAX);
  assert.equal(parsed[0].sessionId, 's0');
  assert.equal(parsed[MAX - 1].sessionId, `s${MAX - 1}`);
}

// 4. A non-array payload is rejected so the loader removes the key.
{
  assert.throws(() => parseFavoriteSessions('{"sessionId":"s1"}'));
  assert.throws(() => parseFavoriteSessions('{not json'));
}

// 5. Serialized output is capped and only contains the explicit model fields.
{
  const oversized = Array.from({ length: MAX + 5 }, (_, index) => ({
    sessionId: `s${index}`,
    projectPath: '/work/a',
    title: `T${index}`,
    projectLabel: 'legacy',
    favoritedAt: index,
  }));
  const serialized = JSON.parse(serializeFavoriteSessions(oversized));
  assert.equal(serialized.length, MAX);
  assert.deepEqual(Object.keys(serialized[0]).sort(), ['favoritedAt', 'projectPath', 'sessionId', 'title']);
}

console.log('favorites storage tests passed');
