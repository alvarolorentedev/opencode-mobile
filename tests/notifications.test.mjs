import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Pending completion-notification records are the contract between a prompt and
// the background monitor. This suite pins down that they are keyed by
// connection scope + session ID, carry no secrets, migrate safely, and drop
// malformed entries instead of crashing hydration.

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
const notificationPendingUri = await transpileToDataUri('lib/notification-pending.ts', [
  [/from '@\/lib\/connection-scope'/g, `from "${connectionScopeUri}"`],
]);

const { getConnectionScope } = await import(connectionScopeUri);
const {
  parsePendingNotificationSessions,
  pendingNotificationKey,
  serializePendingNotificationSessions,
} = await import(notificationPendingUri);

const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

// 1. Keys embed the connection scope, so identical session IDs on two servers
// never collide.
assert.equal(pendingNotificationKey(scopeA, 'session-1'), pendingNotificationKey(scopeA, 'session-1'));
assert.notEqual(pendingNotificationKey(scopeA, 'session-1'), pendingNotificationKey(scopeB, 'session-1'));
assert.match(pendingNotificationKey(scopeA, 'session-1'), /^[A-Za-z0-9_-]+\u0000session-1$/);

// 2. Valid records map to the explicit DTO with unknown fields dropped.
{
  const pending = {
    sessionId: 'session-1',
    sessionTitle: 'Ship it',
    projectPath: '/repo',
    connectionScope: scopeA,
    settings: { serverUrl: 'https://a.example', username: 'alice', password: 'leaked', extra: 1 },
    requestedAt: 123,
    extra: 'nope',
  };
  const parsed = parsePendingNotificationSessions(JSON.stringify({ 'stale-key': pending }));
  const key = pendingNotificationKey(scopeA, 'session-1');
  assert.deepEqual(parsed[key], {
    sessionId: 'session-1',
    sessionTitle: 'Ship it',
    projectPath: '/repo',
    connectionScope: scopeA,
    settings: { serverUrl: 'https://a.example', username: 'alice' },
    requestedAt: 123,
  });
  assert.equal(JSON.stringify(parsed).includes('leaked'), false);
  assert.equal(JSON.stringify(serializePendingNotificationSessions(parsed)).includes('leaked'), false);
}

// 3. Legacy records without a scope are attributed through their server URL +
// username instead of by guessing, so pending tasks keep working across the
// upgrade.
{
  const legacy = {
    'session-2': {
      sessionId: 'session-2',
      projectPath: '/repo',
      settings: { serverUrl: 'https://a.example/', username: 'alice', password: 'legacy-secret' },
      requestedAt: 9,
    },
  };
  const parsed = parsePendingNotificationSessions(JSON.stringify(legacy));
  const key = pendingNotificationKey(scopeA, 'session-2');
  assert.deepEqual(parsed[key], {
    sessionId: 'session-2',
    projectPath: '/repo',
    connectionScope: scopeA,
    settings: { serverUrl: 'https://a.example/', username: 'alice' },
    requestedAt: 9,
  });
  assert.equal(JSON.stringify(parsed).includes('legacy-secret'), false);
}

// 4. Malformed entries are dropped individually; a record that cannot name a
// server is discarded.
{
  const entries = {
    ok: {
      sessionId: 'ok',
      projectPath: '/repo',
      connectionScope: scopeA,
      settings: { serverUrl: 'https://a.example', username: '' },
      requestedAt: 1,
    },
    'no-session': { projectPath: '/repo', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: '' }, requestedAt: 1 },
    'empty-session': { sessionId: ' ', projectPath: '/repo', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: '' }, requestedAt: 1 },
    'no-path': { sessionId: 's', projectPath: '', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: '' }, requestedAt: 1 },
    'bad-time': { sessionId: 's', projectPath: '/repo', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: '' }, requestedAt: 'now' },
    'no-settings': { sessionId: 's', projectPath: '/repo', connectionScope: scopeA, requestedAt: 1 },
    'no-connection': { sessionId: 's', projectPath: '/repo', settings: { username: '' }, requestedAt: 1 },
    'not-an-object': 'nope',
  };
  const parsed = parsePendingNotificationSessions(JSON.stringify(entries));
  assert.deepEqual(Object.keys(parsed), [pendingNotificationKey(scopeA, 'ok')]);
}

// 5. A non-object payload throws so the caller removes the key; malformed JSON
// propagates the JSON error.
assert.throws(() => parsePendingNotificationSessions('[]'));
assert.throws(() => parsePendingNotificationSessions('{not json'));

// 6. Two servers can track the same session ID at once.
{
  const parsed = parsePendingNotificationSessions(JSON.stringify({
    a: { sessionId: 'shared', projectPath: '/repo', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: 'alice' }, requestedAt: 1 },
    b: { sessionId: 'shared', projectPath: '/repo', connectionScope: scopeB, settings: { serverUrl: 'https://b.example', username: 'alice' }, requestedAt: 2 },
  }));
  assert.equal(Object.keys(parsed).length, 2);
  assert.equal(parsed[pendingNotificationKey(scopeA, 'shared')].requestedAt, 1);
  assert.equal(parsed[pendingNotificationKey(scopeB, 'shared')].requestedAt, 2);
}

console.log('notification pending tests passed');
