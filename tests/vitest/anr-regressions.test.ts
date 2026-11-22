import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it, vi } from 'vitest';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('ANR regression checks', () => {
  it('reuses one Intl.Collator and keeps the Android content-capture opt-out idempotent', async () => {
    const Collator = Intl.Collator;
    const allocations = vi.spyOn(Intl, 'Collator').mockImplementation(function () { return new Collator(); });
    const { discoverProviderCapabilities } = await import('@/features/ai/services/capabilities-service');
    const names = ['Éclair', 'alpha', 'Alpha', ...Array.from({ length: 2000 }, (_, i) => `Model ${2000 - i}`)];
    const models = Object.fromEntries(names.map((name, i) => [String(i), {
      id: String(i), name, capabilities: { input: { text: true } }, limit: { context: 1000, output: 100 },
      ...(i === 0 ? { variants: [{ id: 'max' }] } : {}),
    }]));
    const client = {
      config: { get: async () => ({ data: {} }) },
      provider: {
        list: async () => ({ data: { all: [{ id: 'test', name: 'Test', models }], connected: ['test'], default: { test: '1' } } }),
        auth: async () => ({ data: {} }),
      },
      app: { agents: async () => ({ data: [] }) },
    };
    vi.doMock('expo-speech', () => ({
      getAvailableVoicesAsync: async () => names.slice(0, 3).map((name) => ({ identifier: name, name, language: 'en', quality: 'Default' })),
    }));
    const { getSpeechVoiceOptions } = await import('@/shared/platform/voice/system-tts');
    const sortedModels = names.filter((_, i) => i !== 1).sort((a, b) => a.localeCompare(b));
    const sortedVoices = names.slice(0, 3).map((name) => `${name} (en)`).sort((a, b) => a.localeCompare(b));
    const compare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('Do not allocate a collator per comparison');
    });
    try {
      for (let i = 0; i < 2; i += 1) {
        const scoped = { compatibility: client, __opencode: { directory: '/repo' } } as unknown as ScopedOpencodeClient;
        const result = await discoverProviderCapabilities(scoped);
        assert.equal(result.models.length, names.length);
        assert.ok(result.models.every((model) => model.variants.length === 0), 'V1 catalog models must not expose server variants');
        assert.equal(result.models[0].modelID, '1');
        assert.deepEqual(result.models.slice(1).map((model) => model.label), sortedModels);
      }
      assert.deepEqual((await getSpeechVoiceOptions()).map((voice) => voice.label), sortedVoices);
      assert.equal(allocations.mock.calls.length, 1);
    } finally {
      compare.mockRestore();
      allocations.mockRestore();
    }

    // Exercise the real Expo mod in both variants; generated native folders are
    // disposable, so the opt-out must survive clean and repeated prebuilds.
    for (const variant of ['production', 'development']) {
      vi.resetModules();
      vi.stubEnv('EXPO_APP_VARIANT', variant);
      vi.stubGlobal('require', createRequire(new URL('../../app.config.ts', import.meta.url)));
      const { default: appConfig } = await import('@/app.config');
      assert.equal(appConfig.android?.softwareKeyboardLayoutMode, 'resize');
      type AndroidMod = (config: Record<string, unknown>) => {
        mods: { android: { mainActivity: (config: unknown) => Promise<{ modResults: { contents: string } }> } };
      };
      const plugin = (appConfig.plugins as unknown[]).find((entry): entry is AndroidMod => typeof entry === 'function');
      assert.ok(plugin);
      const config = plugin({ name: 'Test', slug: 'test' });
      const apply = (contents: string, language = 'kt') => config.mods.android.mainActivity({
        ...config,
        modRequest: {},
        modResults: { contents, language },
      });
      const original = 'class MainActivity {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(null)\n  }\n}\n';
      const { modResults: { contents } } = await apply(original);
      assert.match(contents, /SDK_INT >= android\.os\.Build\.VERSION_CODES\.Q/);
      assert.match(contents, /getSystemService\(android\.view\.contentcapture\.ContentCaptureManager::class\.java\)\s*\?\.setContentCaptureEnabled\(false\)/);
      assert.ok(contents.indexOf('setContentCaptureEnabled(false)') > contents.indexOf('super.onCreate(null)'));
      assert.equal((await apply(contents)).modResults.contents, contents);
      await assert.rejects(apply(original, 'java'), /requires the generated Kotlin MainActivity/);
      await assert.rejects(apply('class MainActivity {}'), /Failed to match/);
    }
  });
});
