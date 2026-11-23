import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import * as storageKeys from '@/shared/storage/keys';
import * as connectionScope from '@/shared/contracts/connection-scope';

describe('connection profiles', () => {
  it('validates profiles, resolves scoped credentials, and serializes one transaction', async () => {
    const asyncValues = new Map<string, string>();
    const secureValues = new Map<string, string>();
    const platform = { OS: 'android' };
    const asyncStorage = {
      async getItem(key: string) { return asyncValues.get(key) ?? null; },
      async setItem(key: string, value: string) { asyncValues.set(key, value); },
      async removeItem(key: string) { asyncValues.delete(key); },
    };
    const secureStore = {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock',
      async getItemAsync(key: string) { return secureValues.get(key) ?? null; },
      async setItemAsync(key: string, value: string) { secureValues.set(key, value); },
      async deleteItemAsync(key: string) { secureValues.delete(key); },
    };
    let nextId = 0;
    vi.doMock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }));
    vi.doMock('expo-secure-store', () => secureStore);
    vi.doMock('react-native', () => ({ Platform: platform }));
    vi.doMock('expo-constants', () => ({
      default: { expoConfig: { extra: { connectPilot: { enabled: true, controlPlanes: ['https://api.opencodecloud.link'] } } } },
    }));
    vi.doMock('expo-crypto', () => ({
      randomUUID: () => '00000000-0000-4000-8000-' + String(++nextId).padStart(12, '0'),
    }));

    const connectionHeaders = await import('@/shared/storage/connection-headers');
    const {
      deleteProfilePassword, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles,
      resolveConnectionCredentials, saveProfilePassword, saveConnectProfile,
    } = await import('@/shared/storage/connection-profiles');
    const { findMatchingProfile, findProfileByConnectionScope, pickModelPreferences, toConnectionProfile } =
      await import('@/shared/contracts/connection-profiles');

    const resolveConnectionPassword = async (identity: { serverUrl: string; username: string }) => (
      await resolveConnectionCredentials(identity)
    )?.password;
    const saveConnectionProfiles = (profiles: Awaited<ReturnType<typeof loadConnectionProfiles>>) => (
      mutateConnectionProfiles(async (_current: any, save: any) => { await save(profiles); })
    );

    const passwordStorageKey = 'opencode-mobile.connection-password';
    assert.equal(await resolveConnectionCredentials({ serverUrl: '', username: '' }), undefined);
    assert.equal(await resolveConnectionCredentials({ serverUrl: 'http://', username: '' }), undefined);

    const parked = { serverUrl: 'https://parked.example', username: 'alice' };
    await saveConnectionProfiles([{ id: 'parked', name: 'Parked', ...parked }]);
    await saveProfilePassword('parked', 'retained-secret');
    const storedParked = { id: connectionScope.getConnectionUiScope(parked), name: 'Parked', projects: [''], preferences: {}, settings: parked };
    await asyncStorage.setItem('opencode-mobile.workspaces', JSON.stringify({ version: 1, connections: [{ ...storedParked, enabled: false }] }));
    assert.equal(await resolveConnectionCredentials(parked), undefined, 'Disconnected servers must not be polled by background tasks or widgets.');
    assert.equal(await getProfilePassword('parked'), 'retained-secret');
    await asyncStorage.setItem('opencode-mobile.workspaces', JSON.stringify({ version: 1, connections: [{ ...storedParked, enabled: true }] }));
    assert.deepEqual(await resolveConnectionCredentials(parked), { password: 'retained-secret', headers: {} });
    await asyncStorage.removeItem('opencode-mobile.workspaces');

    function resetStorage() {
      asyncValues.clear();
      secureValues.clear();
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
          enabledModelIds: ['openai/gpt-5'],
          knownModelIds: ['openai/gpt-5', 'openai/gpt-4.1'],
          autoEnableNewModels: false,
          recentModelIds: ['openai/gpt-5'],
          mode: 'plan',
          autoApprove: true,
          ignored: 'nope',
        },
      });
      assert.deepEqual(profile, {
        id: 'p1',
        name: 'Home',
        serverUrl: 'https://Example.com/OpenCode',
        username: 'alice',
        modelPreferences: {
          enabledModelIds: ['openai/gpt-5'],
          knownModelIds: ['openai/gpt-5', 'openai/gpt-4.1'],
          autoEnableNewModels: false,
          recentModelIds: ['openai/gpt-5'],
          mode: 'plan',
          autoApprove: true,
        },
      });

      // Server-scoped catalog and routing preferences survive a profile save.
      const autoModel = { enabled: false, classifier: 'local', tiers: { simple: 'auto', standard: 'auto', complex: 'auto' }, protectLongChats: true };
      assert.deepEqual(pickModelPreferences({
        enabledModelIds: ['openai/gpt-5'],
        knownModelIds: ['openai/gpt-5', 'openai/gpt-4.1'],
        autoEnableNewModels: false,
        recentModelIds: ['openai/gpt-5'],
        mode: 'plan',
        autoApprove: true,
        autoModel,
      } as any), {
        enabledModelIds: ['openai/gpt-5'],
        knownModelIds: ['openai/gpt-5', 'openai/gpt-4.1'],
        autoEnableNewModels: false,
        recentModelIds: ['openai/gpt-5'],
        mode: 'plan',
        autoApprove: true,
        autoModel,
      });
    }

    // 2. Malformed retained preferences are dropped; removed model-selection
    // fields are ignored as unknown legacy data.
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
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { enabledModelIds: [1] } }), undefined);
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { knownModelIds: [1] } }), undefined);
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { autoEnableNewModels: 'yes' } }), undefined);
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { recentModelIds: 'x' } }), undefined);
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { mode: 5 } }), undefined);
      assert.equal(toConnectionProfile({ ...base, modelPreferences: { autoApprove: 'yes' } }), undefined);

      // Absent or empty preferences stay absent rather than becoming blank values.
      assert.deepEqual(toConnectionProfile({ ...base, modelPreferences: null }), base);
      assert.deepEqual(toConnectionProfile({ ...base, modelPreferences: {} }), base);
      assert.deepEqual(toConnectionProfile({ ...base, modelPreferences: { modelId: 'legacy', agentModelSelections: { build: 'legacy' }, modelVariantSelections: { legacy: 'high' } } }), base);
    }

    // 3. Hydration drops corrupt and malformed entries individually, rewrites the
    // stored value with explicit fields only, and never crashes on bad JSON.
    {
      resetStorage();
      await asyncStorage.setItem(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, '{not json');
      assert.deepEqual(await loadConnectionProfiles(), []);
      assert.equal(asyncValues.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

      await asyncStorage.setItem(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, '{"not":"an array"}');
      assert.deepEqual(await loadConnectionProfiles(), []);
      assert.equal(asyncValues.has(storageKeys.CONNECTION_PROFILES_STORAGE_KEY), false);

      const stored = [
        { id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u', password: 'leaked', extra: true },
        { id: 'bad-prefs', name: 'Bad', serverUrl: 'https://b.example', username: '', modelPreferences: { enabledModelIds: [1] } },
        { name: 'missing id', serverUrl: 'https://c.example', username: '' },
      ];
      asyncValues.set(storageKeys.CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(stored));
      const loaded = await loadConnectionProfiles();
      assert.deepEqual(loaded, [{ id: 'keep', name: 'Keep', serverUrl: 'https://a.example', username: 'u' }]);

      const rewritten = asyncValues.get(storageKeys.CONNECTION_PROFILES_STORAGE_KEY);
      assert.ok(rewritten);
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
      await connectionHeaders.saveProfileHeaders('p1', { 'CF-Access-Client-Id': 'client-id' });
      await setActiveConnection({ serverUrl: 'https://b.example', username: 'bob' });
      await secureStore.setItemAsync(passwordStorageKey, 'server-b-secret');
      await connectionHeaders.saveConnectionHeaders({ 'CF-Access-Client-Secret': 'active-header-secret' });

      assert.equal(await resolveConnectionPassword({ serverUrl: 'https://a.example', username: 'alice' }), 'server-a-secret');
      assert.equal(await resolveConnectionPassword({ serverUrl: 'https://A.example/', username: 'alice' }), 'server-a-secret');
      assert.equal(await resolveConnectionPassword({ serverUrl: 'https://b.example', username: 'bob' }), 'server-b-secret');
      assert.equal(await resolveConnectionPassword({ serverUrl: 'https://c.example', username: 'carol' }), undefined);
      assert.equal(await resolveConnectionPassword({ serverUrl: 'https://a.example', username: 'mallory' }), undefined);

      // Gateway headers resolve from the same connection as the password.
      assert.deepEqual(await resolveConnectionCredentials({ serverUrl: 'https://a.example', username: 'alice' }), {
        password: 'server-a-secret', headers: { 'CF-Access-Client-Id': 'client-id' },
      });
      assert.deepEqual(await resolveConnectionCredentials({ serverUrl: 'https://b.example', username: 'bob' }), {
        password: 'server-b-secret', headers: { 'CF-Access-Client-Secret': 'active-header-secret' },
      });
      assert.deepEqual(await resolveConnectionCredentials({ serverUrl: 'https://c.example', username: 'carol' }), undefined);

      // Passwords and headers never reach AsyncStorage: profiles, active
      // settings, and the resolution path all keep them in SecureStore.
      for (const value of asyncValues.values()) {
        assert.equal(value.includes('server-a-secret'), false);
        assert.equal(value.includes('server-b-secret'), false);
        assert.equal(value.includes('client-id'), false);
        assert.equal(value.includes('active-header-secret'), false);
      }
    }

    // 6. Profile password storage uses its own SecureStore key and delete clears it.
    {
      resetStorage();
      await saveProfilePassword('p9', 'secret');
      assert.equal(await getProfilePassword('p9'), 'secret');
      assert.equal(secureValues.get('opencode-mobile.connection-profile-password.p9'), 'secret');
      await deleteProfilePassword('p9');
      assert.equal(secureValues.has('opencode-mobile.connection-profile-password.p9'), false);
      assert.equal(await getProfilePassword('p9'), '');

      platform.OS = 'web';
      await saveProfilePassword('p9', 'ignored');
      assert.equal(secureValues.has('opencode-mobile.connection-profile-password.p9'), false);
      platform.OS = 'android';
    }

    // Connect re-pairing replaces only this control-plane/machine's profile and
    // removes the previous secret. Metadata remains explicit and password-free.
    {
      resetStorage();
      const claim = { server_url: 'https://m.example.test', machine_id: 'machine-1', machine_name: 'My Mac', device_id: 'device-1', device_secret: 'signed-secret-1', expires_at: new Date(Date.now() + 60_000).toISOString() };
      const first = await saveConnectProfile('https://api.opencodecloud.link', claim);
      assert.equal(await resolveConnectionPassword(first), 'signed-secret-1');
      assert.deepEqual(await resolveConnectionCredentials(first), { password: 'signed-secret-1', headers: {}, connect: first.connect }, 'Background clients must carry expiry metadata into their fetch guard.');
      const next = await saveConnectProfile('https://api.opencodecloud.link', { ...claim, device_id: 'device-2', device_secret: 'signed-secret-2' });
      assert.ok(first.connect && next.connect);
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
      for (const value of asyncValues.values()) assert.ok(!value.includes('signed-secret'));
      assert.equal(toConnectionProfile({ ...next, connect: { ...next.connect, expiresAt: 'bad' } }), undefined);
      assert.equal(toConnectionProfile({ ...next, username: 'another-device' }), undefined);
      await setActiveConnection({ serverUrl: next.serverUrl, username: next.username, connect: next.connect });
      await secureStore.setItemAsync(passwordStorageKey, 'signed-secret-2');
      const moved = await saveConnectProfile('https://api.opencodecloud.link', { ...claim, server_url: 'https://moved.example.test', device_id: 'device-3', device_secret: 'signed-secret-3' });
      assert.equal(moved.id, next.id, 'A same-machine server move keeps the profile identity.');
      assert.equal(moved.serverUrl, 'https://moved.example.test');
      assert.equal(await getProfilePassword(next.id), 'signed-secret-3');
      const replaced = await saveConnectProfile('https://api.opencodecloud.link', { ...claim, machine_id: 'machine-2', server_url: 'https://replacement.example.test', device_id: 'device-4', device_secret: 'signed-secret-4' }, moved);
      assert.equal(replaced.id, moved.id, 'A replacement machine reuses the stored profile identity.');
      assert.equal(replaced.connect?.machineId, 'machine-2');
      assert.equal(replaced.serverUrl, 'https://replacement.example.test');
      assert.deepEqual(await loadConnectionProfiles(), [replaced]);
      assert.equal(await getProfilePassword(moved.id), 'signed-secret-4');

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
      assert.equal(secureValues.size, 1);
      const originalGet = asyncStorage.getItem;
      asyncStorage.getItem = async () => { throw new Error('storage unavailable'); };
      await assert.rejects(saveConnectProfile('https://api.opencodecloud.link', claim), /storage unavailable/);
      asyncStorage.getItem = originalGet;
      assert.deepEqual(await loadConnectionProfiles(), [kept]);
      assert.equal(secureValues.size, 1, 'A read failure cannot overwrite existing profiles or secrets.');
    }

    // Manual credentials, Cloud Link and preference writes share one transaction.
    {
      resetStorage();
      const manual = { id: 'manual', name: 'Manual', serverUrl: 'http://alice:private@host.test/proxy', username: 'configured' };
      await saveConnectionProfiles([manual]);
      assert.equal((await loadConnectionProfiles())[0].serverUrl, 'http://host.test/proxy');
      const rawManual = asyncValues.get(storageKeys.CONNECTION_PROFILES_STORAGE_KEY);
      assert.ok(rawManual);
      assert.ok(!rawManual.includes('private'));
      const entered = Promise.withResolvers<void>(), credential = Promise.withResolvers<void>();
      const edit = mutateConnectionProfiles(async (stored: any, save: any) => {
        entered.resolve(); await credential.promise;
        await saveProfilePassword('manual', 'manual-secret');
        await save(stored.map((profile: any) => ({ ...profile, name: 'Edited' })));
      });
      await entered.promise;
      const cloud = saveConnectProfile('https://api.opencodecloud.link', { server_url: 'https://cloud.test', machine_id: 'machine', machine_name: 'Cloud', device_id: 'device', device_secret: 'cloud-secret', expires_at: new Date(Date.now() + 60_000).toISOString() });
      const preferences = mutateConnectionProfiles(async (stored: any, save: any) => save(stored.map((profile: any) => profile.id === 'manual' ? { ...profile, modelPreferences: { enabledModelIds: ['provider/model'] } } : profile)));
      credential.resolve(); await Promise.all([edit, cloud, preferences]);
      const stored = await loadConnectionProfiles();
      assert.equal(stored.length, 2);
      assert.equal(stored.find((profile: any) => profile.id === 'manual')!.name, 'Edited');
      assert.deepEqual(stored.find((profile: any) => profile.id === 'manual')!.modelPreferences!.enabledModelIds, ['provider/model']);
      assert.equal(await getProfilePassword('manual'), 'manual-secret');
      assert.equal(await getProfilePassword((await cloud).id), 'cloud-secret');
      await assert.rejects(mutateConnectionProfiles(async () => { throw new Error('failed writer'); }), /failed writer/);
      assert.equal((await loadConnectionProfiles()).length, 2, 'A rejected writer must release the queue.');
    }
  });
});
