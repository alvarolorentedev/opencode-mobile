import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Same transport as tests/session-cache.test.mjs: transpile TS and import via
// data URIs, rewriting the `@/` alias and replacing native modules with stubs.
// The point of this suite is that the persisted profile model and the
// credential resolution stay explicit, validated, and password-free.

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

// Shared stub state lives on globalThis so every data-URI module instance sees
// the same maps.
globalThis.__profilesTestAsyncStorage = new Map();
globalThis.__profilesTestSecureStore = new Map();
globalThis.__profilesTestPlatformOS = 'android';

const asyncStorageStubUri = `data:text/javascript,${encodeURIComponent(`
  export default {
    async getItem(key) { return globalThis.__profilesTestAsyncStorage.has(key) ? globalThis.__profilesTestAsyncStorage.get(key) : null; },
    async setItem(key, value) { globalThis.__profilesTestAsyncStorage.set(key, value); },
    async removeItem(key) { globalThis.__profilesTestAsyncStorage.delete(key); },
  };
`)}`;
const secureStoreStubUri = `data:text/javascript,${encodeURIComponent(`
  export async function getItemAsync(key) { return globalThis.__profilesTestSecureStore.has(key) ? globalThis.__profilesTestSecureStore.get(key) : null; }
  export async function setItemAsync(key, value) { globalThis.__profilesTestSecureStore.set(key, value); }
  export async function deleteItemAsync(key) { globalThis.__profilesTestSecureStore.delete(key); }
`)}`;
const reactNativeStubUri = `data:text/javascript,${encodeURIComponent(`
  export const Platform = { get OS() { return globalThis.__profilesTestPlatformOS; } };
`)}`;

const base64Uri = `data:text/javascript,${encodeURIComponent(
  `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
)}`;

const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
  [/from 'base-64'/g, `from "${base64Uri}"`],
]);
const storageKeysUri = await transpileToDataUri('lib/storage-keys.ts');
const connectionPasswordUri = await transpileToDataUri('lib/connection-password.ts', [
  [/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`],
  [/from 'expo-secure-store'/g, `from "${secureStoreStubUri}"`],
  [/from 'react-native'/g, `from "${reactNativeStubUri}"`],
  [/from '@\/lib\/storage-keys'/g, `from "${storageKeysUri}"`],
]);
const connectionProfilesUri = await transpileToDataUri('lib/connection-profiles.ts', [
  [/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`],
  [/from 'expo-secure-store'/g, `from "${secureStoreStubUri}"`],
  [/from 'react-native'/g, `from "${reactNativeStubUri}"`],
  [/from '@\/lib\/connection-password'/g, `from "${connectionPasswordUri}"`],
  [/from '@\/lib\/connection-scope'/g, `from "${connectionScopeUri}"`],
  [/from '@\/lib\/storage-keys'/g, `from "${storageKeysUri}"`],
]);

const asyncStorage = (await import(asyncStorageStubUri)).default;
const secureStore = await import(secureStoreStubUri);
const storageKeys = await import(storageKeysUri);
const connectionScope = await import(connectionScopeUri);
const {
  deleteProfilePassword,
  findMatchingProfile,
  findProfileByConnectionScope,
  getProfilePassword,
  loadConnectionProfiles,
  resolveConnectionPassword,
  saveConnectionProfiles,
  saveProfilePassword,
  toConnectionProfile,
} = await import(connectionProfilesUri);

const passwordStorageKey = 'opencode-mobile.connection-password';

function resetStorage() {
  globalThis.__profilesTestAsyncStorage.clear();
  globalThis.__profilesTestSecureStore.clear();
}

async function setActiveConnection(settings) {
  await asyncStorage.setItem(storageKeys.SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

// 1. A complete profile round-trips with explicit fields only; unknown fields
// are dropped and strings are trimmed.
{
  const profile = toConnectionProfile({
    id: ' p1 ',
    name: ' Home ',
    serverUrl: ' https://Example.com/OpenCode ',
    username: ' alice ',
    ignored: 'nope',
    modelPreferences: {
      providerId: 'openai',
      modelId: 'gpt-5',
      enabledModelIds: ['openai/gpt-5'],
      providerModelSelections: { openai: 'gpt-5' },
      recentModelIds: ['openai/gpt-5'],
      ignored: 'nope',
    },
  });
  assert.deepEqual(profile, {
    id: 'p1',
    name: 'Home',
    serverUrl: 'https://Example.com/OpenCode',
    username: 'alice',
    modelPreferences: {
      providerId: 'openai',
      modelId: 'gpt-5',
      enabledModelIds: ['openai/gpt-5'],
      providerModelSelections: { openai: 'gpt-5' },
      recentModelIds: ['openai/gpt-5'],
    },
  });
}

// 2. Malformed profiles and malformed model preferences are dropped instead of
// hydrating partial state.
{
  const base = { id: 'p1', name: 'Home', serverUrl: 'https://example.com', username: '' };
  assert.equal(toConnectionProfile(null), undefined);
  assert.equal(toConnectionProfile('profile'), undefined);
  assert.equal(toConnectionProfile([]), undefined);
  assert.equal(toConnectionProfile({ ...base, id: '  ' }), undefined);
  assert.equal(toConnectionProfile({ ...base, name: 5 }), undefined);
  assert.equal(toConnectionProfile({ ...base, serverUrl: '' }), undefined);
  assert.equal(toConnectionProfile({ ...base, username: 5 }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: [] }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: { providerId: 5 } }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: { modelId: {} } }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: { enabledModelIds: [1] } }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: { providerModelSelections: { a: 1 } } }), undefined);
  assert.equal(toConnectionProfile({ ...base, modelPreferences: { recentModelIds: 'x' } }), undefined);

  // Absent or empty preferences stay absent rather than becoming blank values.
  assert.deepEqual(toConnectionProfile({ ...base, modelPreferences: null }), base);
  assert.deepEqual(toConnectionProfile({ ...base, modelPreferences: {} }), base);
}

// 3. Hydration drops corrupt and malformed entries individually, rewrites the
// stored value with the explicit model, and never crashes on bad JSON.
{
  resetStorage();
  await asyncStorage.setItem(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, '{not json');
  assert.deepEqual(await loadConnectionProfiles(), []);
  assert.equal(globalThis.__profilesTestAsyncStorage.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

  await asyncStorage.setItem(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, '{"not":"an array"}');
  assert.deepEqual(await loadConnectionProfiles(), []);
  assert.equal(globalThis.__profilesTestAsyncStorage.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

  const stored = [
    { id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u', password: 'leaked', extra: true },
    { id: 'bad-prefs', name: 'Bad', serverUrl: 'https://b.example', username: '', modelPreferences: { providerId: 5 } },
    { name: 'missing id', serverUrl: 'https://c.example', username: '' },
  ];
  globalThis.__profilesTestAsyncStorage.set(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(stored));
  const loaded = await loadConnectionProfiles();
  assert.deepEqual(loaded, [{ id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u' }]);

  const rewritten = globalThis.__profilesTestAsyncStorage.get(storageKeys.CONNECTION_PROFILES_STORAGE_KEY);
  assert.equal(rewritten.includes('leaked'), false);
  assert.equal(rewritten.includes('extra'), false);
  assert.deepEqual(JSON.parse(rewritten), loaded);
}

// 4. Matching is scope-based: equivalent spellings match, path casing does not.
{
  const profiles = [
    { id: 'p1', name: 'Upper', serverUrl: 'https://Example.com/OpenCode', username: 'alice' },
    { id: 'p2', name: 'Lower', serverUrl: 'https://example.com/opencode', username: 'alice' },
  ];
  assert.equal(findMatchingProfile(profiles, { serverUrl: 'https://example.com/OpenCode/', username: ' alice ' })?.id, 'p1');
  assert.equal(findMatchingProfile(profiles, { serverUrl: 'https://example.com/opencode', username: 'alice' })?.id, 'p2');
  assert.equal(findMatchingProfile(profiles, { serverUrl: 'https://example.com/opencode', username: 'bob' }), undefined);
  assert.equal(
    findProfileByConnectionScope(profiles, connectionScope.getConnectionScope({ serverUrl: 'https://example.com/opencode', username: 'alice' }))?.id,
    'p2',
  );
}

// 5. Credential resolution: a saved profile resolves from SecureStore even when
// it is not the active connection, the active connection resolves when it was
// never saved, and anything else stays unresolved.
{
  resetStorage();
  await saveConnectionProfiles([
    { id: 'p1', name: 'Server A', serverUrl: 'https://a.example', username: 'alice' },
  ]);
  await saveProfilePassword('p1', 'server-a-secret');
  await setActiveConnection({ serverUrl: 'https://b.example', username: 'bob' });
  await secureStore.setItemAsync(passwordStorageKey, 'server-b-secret');

  assert.equal(await resolveConnectionPassword({ serverUrl: 'https://a.example', username: 'alice' }), 'server-a-secret');
  assert.equal(await resolveConnectionPassword({ serverUrl: 'https://A.example/', username: 'alice' }), 'server-a-secret');
  assert.equal(await resolveConnectionPassword({ serverUrl: 'https://b.example', username: 'bob' }), 'server-b-secret');
  assert.equal(await resolveConnectionPassword({ serverUrl: 'https://c.example', username: 'carol' }), undefined);
  assert.equal(await resolveConnectionPassword({ serverUrl: 'https://a.example', username: 'mallory' }), undefined);

  // Passwords never reach AsyncStorage: profiles, active settings, and the
  // resolution path all keep them in SecureStore.
  for (const value of globalThis.__profilesTestAsyncStorage.values()) {
    assert.equal(value.includes('server-a-secret'), false);
    assert.equal(value.includes('server-b-secret'), false);
  }
}

// 6. Profile password storage uses its own SecureStore key and delete clears it.
{
  resetStorage();
  await saveProfilePassword('p9', 'secret');
  assert.equal(await getProfilePassword('p9'), 'secret');
  assert.equal(globalThis.__profilesTestSecureStore.get('opencode-mobile.connection-profile-password.p9'), 'secret');
  await deleteProfilePassword('p9');
  assert.equal(globalThis.__profilesTestSecureStore.has('opencode-mobile.connection-profile-password.p9'), false);
  assert.equal(await getProfilePassword('p9'), '');

  globalThis.__profilesTestPlatformOS = 'web';
  await saveProfilePassword('p9', 'ignored');
  assert.equal(globalThis.__profilesTestSecureStore.has('opencode-mobile.connection-profile-password.p9'), false);
  globalThis.__profilesTestPlatformOS = 'android';
}

console.log('connection profile tests passed');
