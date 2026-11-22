import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { createAppStore } from '@/runtime/core/store';
import { createConnectionSettingsPersistence } from '@/runtime/persistence/connection-settings';
import { createDevicePreferences } from '@/runtime/persistence/device-preferences';
import * as connect from '@/shared/contracts/cloud-link';
import * as keys from '@/shared/storage/keys';
import { createPersistenceWriter, loadPersistedValue } from '@/shared/storage/persistence-hydration';
import { parseChatPreferences, parseConnectionSettings } from '@/shared/storage/persisted-preferences';
import * as preferences from '@/shared/preferences/opencode-preferences';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null, requireNativeModule: () => ({}) }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

// Migrated from the standalone tests/persistence-hydration.test.mjs Node script.
describe('persistence hydration and write-back', () => {
  it('hydrates independently, validates fields, orders writes, and recovers from failures', async () => {
    function createStorage(values: Map<string, string>, failedReads = new Set<string>()) {
      const removed: string[] = [];
      return {
        removed,
        async getItem(key: string) {
          if (failedReads.has(key)) {
            throw new Error('read failed');
          }
          return values.get(key) ?? null;
        },
        async removeItem(key: string) {
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
    const hydrated: Record<string, unknown> = {};
    await loadPersistedValue(storage, 'settings', JSON.parse, (value: any) => { hydrated.settings = value; });
    await loadPersistedValue(storage, 'preferences', JSON.parse, (value: any) => { hydrated.preferences = value; });
    await loadPersistedValue(storage, 'sessions', JSON.parse, (value: any) => { hydrated.sessions = value; });
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
    const isolatedHydrated: Record<string, unknown> = {};
    await loadPersistedValue(isolatedStorage, 'settings', JSON.parse, () => assert.fail('corrupt value should not apply'));
    await loadPersistedValue(isolatedStorage, 'preferences', JSON.parse, (value: any) => { isolatedHydrated.preferences = value; });
    await loadPersistedValue(isolatedStorage, 'sessions', JSON.parse, (value: any) => { isolatedHydrated.sessions = value; });
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
    await loadPersistedValue(applyFailureStorage, 'after-failure', JSON.parse, (value: any) => { valueAfterApplyFailure = value; });
    assert.deepEqual(applyFailureStorage.removed, []);
    assert.deepEqual(valueAfterApplyFailure, { mode: 'plan' });

    await loadPersistedValue(storage, 'missing', JSON.parse, () => assert.fail('missing value should not apply'));

    for (const legacyControlPlane of ['https://api.getopencode.app', 'https://apistaging.getopencode.app']) {
      const storedControlPlane = new Map([['control-plane', legacyControlPlane]]);
      const controlPlaneStorage = createStorage(storedControlPlane);
      let controlPlane = connect.CONNECT_PRODUCTION_URL;
      await loadPersistedValue(controlPlaneStorage, 'control-plane', connect.normalizeTrustedControlPlaneUrl, (value: any) => { controlPlane = value; });
      assert.equal(controlPlane, 'https://api.opencodecloud.link', 'Discarded legacy preferences retain the new production default.');
      assert.deepEqual(controlPlaneStorage.removed, ['control-plane']);
    }
    assert.throws(() => parseConnectionSettings('{"serverUrl":123}'), /Invalid/);
    assert.equal(parseConnectionSettings('{"serverUrl":"https://alice:secret@host.test/proxy","username":"configured"}').serverUrl, 'https://host.test/proxy');
    assert.throws(() => parseConnectionSettings('{"username":"alice","connect":{}}'), /Invalid/);
    assert.deepEqual(JSON.parse(JSON.stringify(parseConnectionSettings('{"serverUrl":"http://test","password":"legacy","unknown":true}'))), { serverUrl: 'http://test', password: 'legacy' });
    const parsed = parseChatPreferences(JSON.stringify({ mode: 'build', enabledModelIds: null, knownModelIds: ['openai/gpt'], autoEnableNewModels: false, recentModelIds: 42,
      providerModelSelections: { p: false }, speechRate: 100, workingSoundVolume: -1, transcriptFontSize: 99, timelineDetail: 'reasoning',
      modelVariantSelections: { 'openai/model': 'max', 'openai/other': null },
      reasoning: 'invalid', hideSubagentChats: 'yes', language: 'es', unknown: 'ignored' }));
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { mode: 'build', knownModelIds: ['openai/gpt'], autoEnableNewModels: false, language: 'es', transcriptFontSize: 24, speechRate: 1.5, workingSoundVolume: 0, timelineDetail: 'reasoning' });
    assert.equal(parseChatPreferences(JSON.stringify({ timelineDetail: 'chatty' })).timelineDetail, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(parseChatPreferences(JSON.stringify({ themeMode: 'dark', accentColor: 'blue' })))), { themeMode: 'dark', accentColor: 'blue' });
    assert.deepEqual(JSON.parse(JSON.stringify(parseChatPreferences(JSON.stringify({ themeMode: 'sepia', accentColor: 'orange' })))), {});
    assert.equal(parseChatPreferences(JSON.stringify({ conversationWakePhrase: '  hey    bot ' })).conversationWakePhrase, 'hey bot');
    assert.equal(parseChatPreferences(JSON.stringify({ conversationWakePhrase: '   ' })).conversationWakePhrase, 'hey code');
    assert.equal(parseChatPreferences(JSON.stringify({ mode: 'build' })).confirmVoiceCommands, undefined);
    assert.equal(parseChatPreferences(JSON.stringify({ confirmVoiceCommands: false })).confirmVoiceCommands, false);
    assert.equal(parseChatPreferences(JSON.stringify({ confirmVoiceCommands: 'yes' })).confirmVoiceCommands, undefined);
    assert.equal(parseChatPreferences(JSON.stringify({ wakePhraseRequired: false })).wakePhraseRequired, false);
    assert.equal(parseChatPreferences(JSON.stringify({ wakePhraseRequired: 'no' })).wakePhraseRequired, undefined);
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseChatPreferences(JSON.stringify({ ttsEngine: 'local', localTtsPackId: 'piper-es', localTtsSpeakerId: 2.8 })))),
      { ttsEngine: 'local', localTtsPackId: 'piper-es', localTtsSpeakerId: 2 },
    );
    assert.equal(parseChatPreferences(JSON.stringify({ localTtsSpeakerId: -4 })).localTtsSpeakerId, 0);
    assert.equal(parseChatPreferences(JSON.stringify({ ttsEngine: 'cloud' })).ttsEngine, undefined);
    const defaults = { ...preferences.defaultChatPreferences, ...parsed };
    assert.ok(Array.isArray(defaults.enabledModelIds)); assert.ok(Array.isArray(defaults.knownModelIds)); assert.ok(Array.isArray(defaults.recentModelIds));
    assert.equal(defaults.autoEnableNewModels, false);
    assert.equal(preferences.defaultChatPreferences.autoEnableNewModels, true);
    const legacyModelPreferences = parseChatPreferences('{"providerId":"openai","modelId":"openai/model","providerModelSelections":{"openai":"openai/model"},"agentModelSelections":{"build":"openai/model"},"modelVariantSelections":{"openai/model":"max"}}');
    assert.deepEqual(JSON.parse(JSON.stringify(legacyModelPreferences)), {});
    const autoModel = {
      enabled: true,
      classifier: 'server',
      classifierModelId: 'openai/nano',
      tiers: { simple: 'openai/nano', standard: 'auto', complex: 'openai/deep' },
      tierVariants: { simple: null, standard: null, complex: null },
      protectLongChats: false,
    };
    assert.deepEqual(JSON.parse(JSON.stringify(parseChatPreferences(JSON.stringify({ autoModel })))), { autoModel });
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseChatPreferences(JSON.stringify({ autoModel: { enabled: 'yes', classifier: 'other', tiers: { simple: '  openai/nano  ' } } })))),
      { autoModel: { enabled: false, classifier: 'local', tiers: { simple: 'openai/nano', standard: 'auto', complex: 'auto' }, tierVariants: { simple: null, standard: null, complex: null }, protectLongChats: true } },
    );

    const write = createPersistenceWriter(), gate = Promise.withResolvers<void>(), writes: string[] = [];
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

    // Unread connection metadata must leave credentials untouched and
    // allow the other independently stored preferences to hydrate.
    let credentialReads = 0;
    let headerReads = 0;
    const stored = new Map([[keys.SETTINGS_STORAGE_KEY, '{"serverUrl":"stored-server"}'],
      [keys.CHAT_PREFERENCES_STORAGE_KEY, '{"language":"es"}'],
      [keys.HIDDEN_PROJECTS_STORAGE_KEY, '{"scope":["/repo","/repo","/other"]}'],
      [keys.PROJECTS_STORAGE_KEY, '{"scope":["/repo","/other"]}'],
      [keys.LAST_SESSION_BY_PROJECT_STORAGE_KEY, '{"scope":{"/repo":"ses_1"}}']]);
    const deviceStorage = {
      getItem: async (key: string) => {
        if (key === keys.SETTINGS_STORAGE_KEY) throw new Error('temporarily unreadable');
        return stored.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => { stored.set(key, value); },
      removeItem: async (key: string) => { stored.delete(key); },
    };
    const device = createDevicePreferences(deviceStorage);
    const connection = createConnectionSettingsPersistence(deviceStorage, {
      getConnectionPassword: async () => { credentialReads++; return 'another-server-secret'; },
      saveConnectionPassword: async () => assert.fail('unread credentials must remain untouched'),
      getConnectionHeaders: async () => { headerReads++; return { 'CF-Access-Client-Secret': 'another-server-header' }; },
      saveConnectionHeaders: async () => assert.fail('unread headers must remain untouched'),
    });
    const defaultSettings = { serverUrl: 'default-server', username: '', password: '', directory: '' };
    const store = createAppStore({ settings: defaultSettings, chatPreferences: preferences.defaultChatPreferences,
      controlPlaneUrl: connect.CONNECT_PRODUCTION_URL }, device.options);
    const settings = await connection.hydrate(defaultSettings);
    store.getState().setShellValue('settings', settings);
    await store.persist.rehydrate();
    await Promise.all([device.flush(), connection.persist(settings)]);
    const hydratedShell = store.getState().shell;
    assert.equal(store.persist.hasHydrated(), true);
    assert.equal(hydratedShell.chatPreferences.language, 'es');
    assert.deepEqual(JSON.parse(JSON.stringify(hydratedShell.hiddenProjects)), { scope: ['/repo', '/other'] });
    assert.equal(stored.has(keys.PROJECTS_STORAGE_KEY), false, 'legacy opened-project lists are removed on hydrate');
    assert.equal(stored.has(keys.LAST_SESSION_BY_PROJECT_STORAGE_KEY), false, 'legacy last-session maps are removed on hydrate');
    assert.equal(credentialReads, 0, 'Unread server metadata must not lend a stored credential to the default server.');
    assert.equal(headerReads, 0, 'Unread server metadata must not lend stored gateway headers to the default server.');
    assert.equal(hydratedShell.settings.password, '');
    assert.deepEqual(JSON.parse(JSON.stringify(hydratedShell.settings.headers)), {});
    assert.equal(stored.get(keys.SETTINGS_STORAGE_KEY), '{"serverUrl":"stored-server"}');
    assert.equal(stored.get(keys.DEVICE_PREFERENCES_VERSION_KEY), '1');
  });

  it('writes only device preferences and preserves records from a newer schema', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    };
    const defaults = {
      settings: { serverUrl: 'https://example.test', username: '', password: 'test-secret', directory: '' },
      chatPreferences: preferences.defaultChatPreferences,
      controlPlaneUrl: connect.CONNECT_PRODUCTION_URL,
    };
    const device = createDevicePreferences(storage);
    const store = createAppStore(defaults, device.options);
    await store.persist.rehydrate();
    store.getState().setShellValue('chatPreferences', { ...preferences.defaultChatPreferences, themeMode: 'dark' });
    store.getState().setSelection('project', { currentSessionId: 'ephemeral-session' });
    await device.flush();
    assert.equal(JSON.parse(values.get(keys.CHAT_PREFERENCES_STORAGE_KEY)!).themeMode, 'dark');
    assert.equal(values.has(keys.SETTINGS_STORAGE_KEY), false);
    assert.equal([...values.values()].join('').includes('test-secret'), false);
    assert.equal([...values.values()].join('').includes('ephemeral-session'), false);

    const future = new Map([
      [keys.DEVICE_PREFERENCES_VERSION_KEY, '99'],
      [keys.CHAT_PREFERENCES_STORAGE_KEY, '{"future":"format","themeMode":"light"}'],
      [keys.HIDDEN_PROJECTS_STORAGE_KEY, 'future record'],
    ]);
    values.clear();
    for (const [key, value] of future) values.set(key, value);
    const secondDevice = createDevicePreferences(storage);
    const second = createAppStore(defaults, secondDevice.options);
    await second.persist.rehydrate();
    assert.equal(second.getState().shell.chatPreferences.themeMode, 'light');
    second.getState().setShellValue('chatPreferences', { ...preferences.defaultChatPreferences, themeMode: 'dark' });
    await secondDevice.flush();
    assert.deepEqual(values, future);
  });
});
