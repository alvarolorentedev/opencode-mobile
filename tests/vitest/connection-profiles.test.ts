import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Same transport as the session-cache suite: transpile TS and import via data
// URIs, rewriting the `@/` alias and replacing native modules with stubs. The
// point of this suite is that the persisted profile model and the credential
// resolution stay explicit, validated, and password-free.
//
// Migrated from the standalone tests/connection-profiles.test.mjs Node script.
describe('connection profiles', () => {
  it('validates profiles, resolves scoped credentials, and serializes one transaction', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, '..', '..');

    async function transpileToDataUri(relativePath: string, replacements: [RegExp, string][] = []) {
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
    const g = globalThis as any;
    g.__profilesTestAsyncStorage = new Map();
    g.__profilesTestSecureStore = new Map();
    g.__profilesTestPlatformOS = 'android';

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
    const cryptoStubUri = `data:text/javascript,${encodeURIComponent(`
      let counter = 0;
      export function randomUUID() {
        counter += 1;
        return '00000000-0000-4000-8000-' + String(counter).padStart(12, '0');
      }
    `)}`;

    const base64Uri = `data:text/javascript,${encodeURIComponent(
      `import base64 from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/base-64/base64.js')).href)}; export const encode = base64.encode;`,
    )}`;

    const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
      [/from 'base-64'/g, `from "${base64Uri}"`],
    ]);
    const storageKeysUri = await transpileToDataUri('lib/storage-keys.ts');
    g.__profilesTestConnectConfig = { extra: { connectPilot: { enabled: true, controlPlanes: ['https://api.opencodecloud.link'] } } };
    const constantsStubUri = `data:text/javascript,${encodeURIComponent(`export default { get expoConfig() { return globalThis.__profilesTestConnectConfig; } };`)}`;
    const connectUri = await transpileToDataUri('lib/connect.ts', [
      [/from 'expo\/fetch'/g, `from "data:text/javascript,export const fetch = (...args) => globalThis.fetch(...args);"`],
      [/from 'expo-constants'/g, `from "${constantsStubUri}"`],
      [/from 'expo-secure-store'/g, `from "${secureStoreStubUri}"`],
      [/from 'react-native'/g, `from "${reactNativeStubUri}"`],
    ]);
    const urlUri = await transpileToDataUri('lib/opencode/client/url.ts', [
      [/from '\.\/types'/g, `from "data:text/javascript,export const defaultConnectionSettings = {serverUrl:'http://localhost'};"`],
    ]);
    const connectionPasswordUri = await transpileToDataUri('lib/connection-password.ts', [
      [/from '@\/lib\/opencode\/client\/url'/g, `from "${urlUri}"`],
      [/from '@\/lib\/connect'/g, `from "${connectUri}"`],
      [/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`],
      [/from 'expo-secure-store'/g, `from "${secureStoreStubUri}"`],
      [/from 'react-native'/g, `from "${reactNativeStubUri}"`],
      [/from '@\/lib\/storage-keys'/g, `from "${storageKeysUri}"`],
    ]);
    const connectionProfilesUri = await transpileToDataUri('lib/connection-profiles.ts', [
      [/from '@\/lib\/opencode\/client\/url'/g, `from "${urlUri}"`],
      [/from '@\/lib\/connect'/g, `from "${connectUri}"`],
      [/from '@react-native-async-storage\/async-storage'/g, `from "${asyncStorageStubUri}"`],
      [/from 'expo-crypto'/g, `from "${cryptoStubUri}"`],
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
      mutateConnectionProfiles,
      resolveConnectionPassword,
      resolveConnectionCredentials,
      saveConnectionProfiles,
      saveProfilePassword,
      saveConnectProfile,
      toConnectionProfile,
    } = await import(connectionProfilesUri);

    const passwordStorageKey = 'opencode-mobile.connection-password';
    assert.equal(await resolveConnectionCredentials({ serverUrl: '', username: '' }), undefined);
    assert.equal(await resolveConnectionCredentials({ serverUrl: 'http://', username: '' }), undefined);

    function resetStorage() {
      g.__profilesTestAsyncStorage.clear();
      g.__profilesTestSecureStore.clear();
    }

    async function setActiveConnection(settings: unknown) {
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
      assert.equal(g.__profilesTestAsyncStorage.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

      await asyncStorage.setItem(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, '{"not":"an array"}');
      assert.deepEqual(await loadConnectionProfiles(), []);
      assert.equal(g.__profilesTestAsyncStorage.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

      const stored = [
        { id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u', password: 'leaked', extra: true },
        { id: 'bad-prefs', name: 'Bad', serverUrl: 'https://b.example', username: '', modelPreferences: { providerId: 5 } },
        { name: 'missing id', serverUrl: 'https://c.example', username: '' },
      ];
      g.__profilesTestAsyncStorage.set(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(stored));
      const loaded = await loadConnectionProfiles();
      assert.deepEqual(loaded, [{ id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u' }]);

      const rewritten = g.__profilesTestAsyncStorage.get(storageKeys.CONNECTION_PROFILES_STORAGE_KEY);
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
      for (const value of g.__profilesTestAsyncStorage.values()) {
        assert.equal(value.includes('server-a-secret'), false);
        assert.equal(value.includes('server-b-secret'), false);
      }
    }

    // 6. Profile password storage uses its own SecureStore key and delete clears it.
    {
      resetStorage();
      await saveProfilePassword('p9', 'secret');
      assert.equal(await getProfilePassword('p9'), 'secret');
      assert.equal(g.__profilesTestSecureStore.get('opencode-mobile.connection-profile-password.p9'), 'secret');
      await deleteProfilePassword('p9');
      assert.equal(g.__profilesTestSecureStore.has('opencode-mobile.connection-profile-password.p9'), false);
      assert.equal(await getProfilePassword('p9'), '');

      g.__profilesTestPlatformOS = 'web';
      await saveProfilePassword('p9', 'ignored');
      assert.equal(g.__profilesTestSecureStore.has('opencode-mobile.connection-profile-password.p9'), false);
      g.__profilesTestPlatformOS = 'android';
    }

    // Connect re-pairing replaces only this control-plane/machine's profile and
    // removes the previous secret. Metadata remains explicit and password-free.
    {
      resetStorage();
      const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'My Mac', device_id: 'device-1', device_secret: 'signed-secret-1', expires_at: new Date(Date.now() + 60_000).toISOString() };
      const first = await saveConnectProfile('https://api.opencodecloud.link', claim);
      assert.equal(await resolveConnectionPassword(first), 'signed-secret-1');
      assert.deepEqual(await resolveConnectionCredentials(first), { password: 'signed-secret-1', connect: first.connect }, 'Background clients must carry expiry metadata into their fetch guard.');
      const next = await saveConnectProfile('https://api.opencodecloud.link', { ...claim, device_id: 'device-2', device_secret: 'signed-secret-2' });
      assert.equal(next.id, first.id, 'Credential rotation preserves user-visible profile identity.');
      assert.equal(findMatchingProfile([first], next)?.id, first.id, 'Rotated Cloud Link usernames still match the saved machine.');
      assert.equal(findMatchingProfile([first], { ...next, connect: { ...next.connect, machineId: 'another-machine' } }), undefined);
      assert.equal(findMatchingProfile([first], { ...next, connect: { ...next.connect, controlPlaneUrl: 'https://apistaging.opencodecloud.link' } }), undefined);
      assert.equal(findMatchingProfile([first], { serverUrl: first.serverUrl, username: next.username }), undefined, 'Manual identities still require an exact credential scope.');
      assert.equal(next.connect.machineId, first.connect.machineId);
      assert.equal(next.serverUrl, first.serverUrl);
      assert.equal(await getProfilePassword(first.id), 'signed-secret-2');
      assert.deepEqual(await loadConnectionProfiles(), [next]);
      assert.equal(await resolveConnectionPassword(next), 'signed-secret-2');
      for (const value of g.__profilesTestAsyncStorage.values()) assert.ok(!value.includes('signed-secret'));
      assert.equal(toConnectionProfile({ ...next, connect: { ...next.connect, expiresAt: 'bad' } }), undefined);
      assert.equal(toConnectionProfile({ ...next, username: 'another-device' }), undefined);
      await setActiveConnection({ serverUrl: next.serverUrl, username: next.username, connect: next.connect });
      await secureStore.setItemAsync(passwordStorageKey, 'signed-secret-2');
      await assert.rejects(saveConnectProfile('https://api.opencodecloud.link', { ...claim, server_url: 'https://replacement.example.test' }), /machine_hostname_mismatch/);

      await saveConnectionProfiles([{ ...next, connect: { ...next.connect, expiresAt: '2000-01-01T00:00:00Z' } }]);
      assert.equal(await resolveConnectionPassword(next), undefined, 'Expired profiles cannot fall back to active credentials.');
      await saveConnectionProfiles([]);
      await setActiveConnection({ serverUrl: next.serverUrl, username: next.username, connect: { ...next.connect, expiresAt: '2000-01-01T00:00:00Z' } });
      assert.equal(await resolveConnectionPassword(next), undefined, 'Active-only Connect credentials also enforce expiry.');

      // A failed metadata write rolls back the new secret and keeps the old profile.
      resetStorage();
      const kept = await saveConnectProfile('https://api.opencodecloud.link', claim);
      const originalSet = asyncStorage.setItem;
      asyncStorage.setItem = async (key: string, value: string) => {
        if (key === storageKeys.CONNECTION_PROFILES_STORAGE_KEY) throw new Error('disk full');
        return originalSet(key, value);
      };
      await assert.rejects(saveConnectProfile('https://api.opencodecloud.link', { ...claim, device_id: 'replacement' }), /disk full/);
      asyncStorage.setItem = originalSet;
      assert.deepEqual(await loadConnectionProfiles(), [kept]);
      assert.equal(g.__profilesTestSecureStore.size, 1);
      const originalGet = asyncStorage.getItem;
      asyncStorage.getItem = async () => { throw new Error('storage unavailable'); };
      await assert.rejects(saveConnectProfile('https://api.opencodecloud.link', claim), /storage unavailable/);
      asyncStorage.getItem = originalGet;
      assert.deepEqual(await loadConnectionProfiles(), [kept]);
      assert.equal(g.__profilesTestSecureStore.size, 1, 'A read failure cannot overwrite existing profiles or secrets.');
    }

    // Manual credentials, Cloud Link and preference writes share one transaction.
    {
      resetStorage();
      const manual = { id: 'manual', name: 'Manual', serverUrl: 'http://alice:private@host.test/proxy', username: 'configured' };
      await saveConnectionProfiles([manual]);
      assert.equal((await loadConnectionProfiles())[0].serverUrl, 'http://host.test/proxy');
      assert.ok(!g.__profilesTestAsyncStorage.get(storageKeys.CONNECTION_PROFILES_STORAGE_KEY).includes('private'));
      const entered = Promise.withResolvers<void>(), credential = Promise.withResolvers<void>();
      const edit = mutateConnectionProfiles(async (stored, save) => {
        entered.resolve(); await credential.promise;
        await saveProfilePassword('manual', 'manual-secret');
        await save(stored.map((profile) => ({ ...profile, name: 'Edited' })));
      });
      await entered.promise;
      const cloud = saveConnectProfile('https://api.opencodecloud.link', { server_url: 'https://cloud.test', machine_id: 'machine', machine_name: 'Cloud', device_id: 'device', device_secret: 'cloud-secret', expires_at: new Date(Date.now() + 60_000).toISOString() });
      const preferences = mutateConnectionProfiles(async (stored, save) => save(stored.map((profile) => profile.id === 'manual' ? { ...profile, modelPreferences: { modelId: 'model' } } : profile)));
      credential.resolve(); await Promise.all([edit, cloud, preferences]);
      const stored = await loadConnectionProfiles();
      assert.equal(stored.length, 2);
      assert.equal(stored.find((profile) => profile.id === 'manual')!.name, 'Edited');
      assert.equal(stored.find((profile) => profile.id === 'manual')!.modelPreferences!.modelId, 'model');
      assert.equal(await getProfilePassword('manual'), 'manual-secret');
      assert.equal(await getProfilePassword((await cloud).id), 'cloud-secret');
      await assert.rejects(mutateConnectionProfiles(async () => { throw new Error('failed writer'); }), /failed writer/);
      assert.equal((await loadConnectionProfiles()).length, 2, 'A rejected writer must release the queue.');
    }
  });
});
