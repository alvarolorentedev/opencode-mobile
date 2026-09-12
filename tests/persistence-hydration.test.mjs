import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../providers/persistence-hydration.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { loadPersistedValue } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

function createStorage(values, failedReads = new Set()) {
  const removed = [];
  return {
    removed,
    async getItem(key) {
      if (failedReads.has(key)) {
        throw new Error('read failed');
      }
      return values.get(key) ?? null;
    },
    async removeItem(key) {
      removed.push(key);
      values.delete(key);
    },
  };
}

const values = new Map([
  ['settings', '{"serverUrl":"http://localhost"}'],
  ['preferences', '{"mode":"build"}'],
  ['sessions', '{"/repo":"session-1"}'],
]);
const storage = createStorage(values);
const hydrated = {};
await loadPersistedValue(storage, 'settings', JSON.parse, (value) => { hydrated.settings = value; });
await loadPersistedValue(storage, 'preferences', JSON.parse, (value) => { hydrated.preferences = value; });
await loadPersistedValue(storage, 'sessions', JSON.parse, (value) => { hydrated.sessions = value; });
assert.deepEqual(hydrated, {
  settings: { serverUrl: 'http://localhost' },
  preferences: { mode: 'build' },
  sessions: { '/repo': 'session-1' },
});

const isolatedValues = new Map([
  ['settings', '{'],
  ['preferences', '{"mode":"build"}'],
  ['sessions', '{"/repo":"session-1"}'],
]);
const isolatedStorage = createStorage(isolatedValues);
const isolatedHydrated = {};
await loadPersistedValue(isolatedStorage, 'settings', JSON.parse, () => assert.fail('corrupt value should not apply'));
await loadPersistedValue(isolatedStorage, 'preferences', JSON.parse, (value) => { isolatedHydrated.preferences = value; });
await loadPersistedValue(isolatedStorage, 'sessions', JSON.parse, (value) => { isolatedHydrated.sessions = value; });
assert.deepEqual(isolatedHydrated, {
  preferences: { mode: 'build' },
  sessions: { '/repo': 'session-1' },
});
assert.deepEqual(isolatedStorage.removed, ['settings']);
assert.equal(isolatedValues.has('settings'), false);

const readFailureStorage = createStorage(new Map([['unreadable', '{']]), new Set(['unreadable']));
await loadPersistedValue(readFailureStorage, 'unreadable', JSON.parse, () => assert.fail('read failure should not apply'));
assert.deepEqual(readFailureStorage.removed, []);

const applyFailureStorage = createStorage(new Map([['apply-failure', '{"mode":"build"}'], ['after-failure', '{"mode":"plan"}']]));
let valueAfterApplyFailure;
await loadPersistedValue(applyFailureStorage, 'apply-failure', JSON.parse, () => { throw new Error('state update failed'); });
await loadPersistedValue(applyFailureStorage, 'after-failure', JSON.parse, (value) => { valueAfterApplyFailure = value; });
assert.deepEqual(applyFailureStorage.removed, []);
assert.deepEqual(valueAfterApplyFailure, { mode: 'plan' });

await loadPersistedValue(storage, 'missing', JSON.parse, () => assert.fail('missing value should not apply'));

console.log('persistence hydration tests passed');
