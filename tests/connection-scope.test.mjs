import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Same transport as tests/session-cache.test.mjs: transpile the TS source and
// import it as a data URI. The only value import, `base-64`, is rewritten to
// the real package so the encoding under test is the production one.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const base64Uri = `data:text/javascript,${encodeURIComponent(
  `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
)}`;

const source = await readFile(path.join(root, 'lib/connection-scope.ts'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const connectionScopeUri = `data:text/javascript,${encodeURIComponent(
  transpiled.replace(/from 'base-64'/g, `from "${base64Uri}"`),
)}`;

const { getConnectionScope, normalizeConnectionUrl } = await import(connectionScopeUri);

function scope(serverUrl, username = '') {
  return getConnectionScope({ serverUrl, username });
}

// 1. Equivalent spellings of the same server resolve to one scope.
assert.equal(scope('https://Example.com/'), scope('https://example.com'));
assert.equal(scope('https://example.com/api/'), scope('https://example.com/api'));
assert.equal(scope('https://example.com/api///'), scope('https://example.com/api'));
assert.equal(scope('HTTPS://EXAMPLE.com/Api/'), scope('https://example.com/Api'));
assert.equal(scope('https://example.com:443'), scope('https://example.com'));
assert.equal(scope('https://example.com/Api?X=1/'), scope('https://example.com/Api?X=1/'));
assert.equal(scope(' example.com '), scope('http://example.com'));

// 2. Parts that can be case-sensitive stay distinct.
assert.notEqual(scope('https://example.com/OpenCode'), scope('https://example.com/opencode'));
assert.notEqual(scope('https://example.com/OpenCode'), scope('https://example.com/OPENCODE'));
assert.notEqual(scope('https://example.com/api?token=AbC'), scope('https://example.com/api?token=abc'));
assert.notEqual(scope('https://example.com/api'), scope('http://example.com/api'));
assert.notEqual(scope('https://example.com/a/b'), scope('https://example.com/a%2Fb'));

// 3. Usernames are part of the identity and are not case-folded.
assert.notEqual(scope('https://example.com', 'alice'), scope('https://example.com', 'bob'));
assert.notEqual(scope('https://example.com', 'Alice'), scope('https://example.com', 'alice'));
assert.equal(scope('https://example.com', ' alice '), scope('https://example.com', 'alice'));
assert.notEqual(scope('https://example.com', ''), scope('https://example.com', 'alice'));

// 4. The identity is deterministic and usable as a storage key segment.
const first = scope('https://example.com/OpenCode', 'alice');
assert.equal(first, scope('https://example.com/OpenCode/', 'alice'));
assert.equal(first, getConnectionScope({ serverUrl: 'https://example.com/OpenCode', username: 'alice' }));
assert.match(first, /^[A-Za-z0-9_-]+$/);
assert.equal(first.includes('alice'), false);
assert.equal(first.includes('example.com'), false);
assert.equal(first.includes('/'), false);

// 5. Empty and unparsable input still produce a deterministic key.
assert.equal(scope(''), scope(''));
assert.match(scope(''), /^[A-Za-z0-9_-]+$/);
assert.equal(normalizeConnectionUrl('not a url').valid, false);
assert.equal(scope('not a url'), scope('not a url'));

// 6. Non-ASCII usernames encode to a key-safe segment without collisions.
const unicode = scope('https://example.com', 'üser-日本');
assert.match(unicode, /^[A-Za-z0-9_-]+$/);
assert.equal(unicode, scope('https://example.com', 'üser-日本'));
assert.notEqual(unicode, scope('https://example.com', 'user-日本'));

// 7. normalizeConnectionUrl keeps path/query casing and drops trailing slashes.
assert.deepEqual(normalizeConnectionUrl('https://Example.com/OpenCode/?Case=Yes'), {
  origin: 'https://example.com',
  pathAndQuery: '/OpenCode?Case=Yes',
  valid: true,
});

console.log('connection scope tests passed');
