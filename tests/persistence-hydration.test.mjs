import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { loadTs, deferred, hookRuntime } from './helpers/runtime.mjs';

const source = await readFile(new URL('../providers/persistence-hydration.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { loadPersistedValue, createPersistenceWriter } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

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
assert.equal(await loadPersistedValue(readFailureStorage, 'unreadable', JSON.parse, () => assert.fail('read failure should not apply')), false);
assert.deepEqual(readFailureStorage.removed, []);

const applyFailureStorage = createStorage(new Map([['apply-failure', '{"mode":"build"}'], ['after-failure', '{"mode":"plan"}']]));
let valueAfterApplyFailure;
await loadPersistedValue(applyFailureStorage, 'apply-failure', JSON.parse, () => { throw new Error('state update failed'); });
await loadPersistedValue(applyFailureStorage, 'after-failure', JSON.parse, (value) => { valueAfterApplyFailure = value; });
assert.deepEqual(applyFailureStorage.removed, []);
assert.deepEqual(valueAfterApplyFailure, { mode: 'plan' });

await loadPersistedValue(storage, 'missing', JSON.parse, () => assert.fail('missing value should not apply'));

const connect = await loadTs('lib/connect.ts', {
  'expo/fetch': {}, 'expo-constants': { default: {} }, 'react-native': { Platform: { OS: 'android' } }, 'expo-secure-store': {},
});
for (const legacyControlPlane of ['https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
  const storedControlPlane = new Map([['control-plane', legacyControlPlane]]);
  const controlPlaneStorage = createStorage(storedControlPlane);
  let controlPlane = connect.CONNECT_PRODUCTION_URL;
  await loadPersistedValue(controlPlaneStorage, 'control-plane', connect.normalizeTrustedControlPlaneUrl, (value) => { controlPlane = value; });
  assert.equal(controlPlane, 'https://api.opencodecloud.link', 'Discarded legacy preferences retain the new production default.');
  assert.deepEqual(controlPlaneStorage.removed, ['control-plane']);
}
const preferences = await loadTs('providers/opencode-preferences.ts');
const accent = await loadTs('constants/accent.ts');
const { parseConnectionSettings, parseChatPreferences } = await loadTs('providers/persisted-preferences.ts', {
  '@/constants/accent': accent, '@/lib/connect': connect, '@/providers/opencode-preferences': preferences,
});
assert.throws(() => parseConnectionSettings('{"serverUrl":123}'), /Invalid/);
assert.throws(() => parseConnectionSettings('{"username":"alice","connect":{}}'), /Invalid/);
assert.deepEqual(JSON.parse(JSON.stringify(parseConnectionSettings('{"serverUrl":"http://test","password":"legacy","unknown":true}'))), { serverUrl: 'http://test', password: 'legacy' });
const parsed = parseChatPreferences(JSON.stringify({ mode: 'build', enabledModelIds: null, recentModelIds: 42,
  providerModelSelections: { p: false }, speechRate: 100, workingSoundVolume: -1, transcriptFontSize: 99,
  reasoning: 'invalid', hideSubagentChats: 'yes', language: 'es', accent: 'magenta', unknown: 'ignored' }));
assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { mode: 'build', language: 'es', transcriptFontSize: 24, speechRate: 1.5, workingSoundVolume: 0 });
assert.equal(parseChatPreferences(JSON.stringify({ accent: 'blue' })).accent, 'blue', 'known accents are accepted');
const defaults = { ...preferences.defaultChatPreferences, ...parsed };
assert.ok(Array.isArray(defaults.enabledModelIds)); assert.ok(Array.isArray(defaults.recentModelIds));
assert.equal(defaults.reasoning, 'default');

const write = createPersistenceWriter(), gate = deferred(), writes = [];
const first = write('settings', 'a', async () => { await gate.promise; writes.push('a'); });
const second = write('settings', 'b', async () => writes.push('b'));
const repeated = write('settings', 'b', async () => writes.push('duplicate'));
gate.resolve(); await Promise.all([first, second, repeated]);
assert.deepEqual(writes, ['a', 'b'], 'writes are ordered and identical values are suppressed');
await assert.rejects(write('settings', 'c', async () => { throw new Error('storage unavailable'); }), /storage unavailable/);
await write('settings', 'c', async () => writes.push('retry'));
assert.equal(writes.at(-1), 'retry');
write.preserveUnread('unreadable');
await write('unreadable', 'defaults', async () => assert.fail('defaults must not replace an unread record'));
await write('unreadable', 'defaults', async () => assert.fail('unchanged defaults must remain blocked'));
await write('unreadable', 'edited', async () => writes.push('explicit edit'));
assert.equal(writes.at(-1), 'explicit edit');
console.log('persistence hydration, field validation, ordered write, and failure recovery tests passed');


// Actual write-back hook: unread settings and unavailable secure credentials do
// not stop independent preferences from hydrating or replace stored defaults.
const hydrationRuntime = hookRuntime();
const keys = await loadTs('lib/storage-keys.ts');
const stored = new Map([[keys.SETTINGS_STORAGE_KEY, '{"serverUrl":"stored-server"}'],
  [keys.CHAT_PREFERENCES_STORAGE_KEY, '{"language":"es"}']]);
const hook = await loadTs('providers/use-opencode-persistence.ts', {
  react: hydrationRuntime.react,
  '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (key) => { if (key === keys.SETTINGS_STORAGE_KEY) throw new Error('temporarily unreadable'); return stored.get(key) ?? null; },
    setItem: async (key, value) => { stored.set(key, value); }, removeItem: async (key) => { stored.delete(key); },
  } },
  '@/lib/connect': { normalizeTrustedControlPlaneUrl: (raw) => raw },
  '@/lib/connection-password': {
    getConnectionPassword: async () => { throw new Error('secure storage unavailable'); },
    saveConnectionPassword: async () => assert.fail('unread credentials must remain untouched'),
    withoutConnectionPassword: ({ password: _, ...metadata }) => metadata,
  },
  '@/lib/storage-keys': keys,
  '@/providers/persisted-preferences': { parseConnectionSettings, parseChatPreferences },
  '@/providers/persistence-hydration': { loadPersistedValue, createPersistenceWriter },
  '@/providers/favorites-storage': { parseFavoriteSessions: JSON.parse, serializeFavoriteSessions: JSON.stringify },
  '@/providers/last-session-storage': { parseLastSessionByConnection: JSON.parse, serializeLastSessionByConnection: JSON.stringify },
  '@/providers/onboarding-state': { loadOnboardingStatus: async () => ({ version: 1 }), serializeOnboardingVersion: String },
}, { console: { warn() {} } });
const defaultSettings = { serverUrl: 'default-server', username: '', password: '' };
hydrationRuntime.mount(() => {
  const [settings, setSettings] = hydrationRuntime.react.useState(defaultSettings);
  const [chatPreferences, setChatPreferences] = hydrationRuntime.react.useState(preferences.defaultChatPreferences);
  const [activeProjectPath, setActiveProjectPath] = hydrationRuntime.react.useState();
  const [controlPlaneUrl, setControlPlaneUrl] = hydrationRuntime.react.useState('control');
  const [favoriteSessions, setFavoriteSessions] = hydrationRuntime.react.useState([]);
  const [lastSessionByConnection, setLastSessionByConnection] = hydrationRuntime.react.useState({});
  const [onboardingVersion, setOnboardingVersion] = hydrationRuntime.react.useState(0);
  return { ...hook.useOpencodePersistence({ defaultSettings, defaultChatPreferences: preferences.defaultChatPreferences,
    settings, setSettings, chatPreferences, setChatPreferences, activeProjectPath, setActiveProjectPath,
    controlPlaneUrl, setControlPlaneUrl, favoriteSessions, setFavoriteSessions,
    lastSessionByConnection, setLastSessionByConnection, onboardingVersion, setOnboardingVersion }), chatPreferences };
}, {});
await hydrationRuntime.settle();
assert.equal(hydrationRuntime.value.isHydrated, true);
assert.equal(hydrationRuntime.value.chatPreferences.language, 'es');
assert.equal(stored.get(keys.SETTINGS_STORAGE_KEY), '{"serverUrl":"stored-server"}');
hydrationRuntime.unmount();
console.log('independent hydration and unread-record write-back checks passed');
