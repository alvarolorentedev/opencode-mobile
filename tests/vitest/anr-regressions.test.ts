import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/anr-regressions.test.mjs Node script.
describe('ANR regression checks', () => {
  it('reuses one Intl.Collator and keeps the Android content-capture opt-out idempotent', async () => {
    const require = createRequire(import.meta.url);
    async function load(relative: string, imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
      const source = await readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
      const exports = {};
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      runInNewContext(`String.prototype.localeCompare = () => { throw new Error('Do not allocate a collator per comparison'); };\n${output}`, {
        exports,
        require: (name: string) => imports[name] ?? require(name),
        ...globals,
      });
      return exports;
    }

    // The complete catalog and voice paths share one collator, including repeated
    // discovery. Keep locale-aware ordering and server-default model priority.
    let allocations = 0;
    const labels = await load('lib/compare-labels.ts', {}, {
      Intl: { Collator: class {
        constructor() {
          allocations += 1;
          return new Intl.Collator();
        }
      } },
    });
    const selection = await load('providers/opencode-model-selection.ts', {
      '@/providers/opencode-preferences': { defaultChatPreferences: { mode: 'build' } },
    });
    const { discoverChatCapabilities } = await load('providers/services/capabilities-service.ts', {
      '@/lib/compare-labels': labels,
      '@/lib/opencode/v2/shared': {},
      '@/lib/opencode/compat/v1/auth': {},
      '@/providers/opencode-model-selection': selection,
      '@/providers/services/require-data': await load('providers/services/require-data.ts'),
    });
    const names = ['Éclair', 'alpha', 'Alpha', ...Array.from({ length: 2000 }, (_, i) => `Model ${2000 - i}`)];
    const models = Object.fromEntries(names.map((name, i) => [String(i), {
      id: String(i), name, capabilities: { input: { text: true } }, limit: { context: 1000, output: 100 },
    }]));
    const client = {
      config: { get: async () => ({ data: {} }) },
      provider: {
        list: async () => ({ data: { all: [{ id: 'test', name: 'Test', models }], connected: ['test'], default: { test: '1' } } }),
        auth: async () => ({ data: {} }),
      },
      app: { agents: async () => ({ data: [] }) },
    };
    for (let i = 0; i < 2; i += 1) {
      const result = await discoverChatCapabilities({ compatibility: client }, '/repo');
      assert.equal(result.models.length, names.length);
      assert.equal(result.models[0].modelID, '1');
      assert.deepEqual(Array.from(result.models.slice(1), (model: any) => model.label), names.filter((_, i) => i !== 1).sort((a, b) => a.localeCompare(b)));
    }
    const { getSpeechVoiceOptions } = await load('lib/voice/speech-output.ts', {
      '@/lib/compare-labels': labels,
      '@/lib/opencode/v2/shared': {},
      '@/lib/opencode/compat/v1/auth': {},
      'expo-speech': { getAvailableVoicesAsync: async () => names.slice(0, 3).map((name) => ({ identifier: name, name, language: 'en' })) },
    });
    assert.deepEqual(Array.from(await getSpeechVoiceOptions(), (voice: any) => voice.label), names.slice(0, 3).map((name) => `${name} (en)`).sort((a, b) => a.localeCompare(b)));
    assert.equal(allocations, 1);

    // Exercise the real Expo mod in both variants; generated native folders are
    // disposable, so the opt-out must survive clean and repeated prebuilds.
    for (const variant of ['production', 'development']) {
      const { default: appConfig } = await load('app.config.ts', {}, { process: { env: { EXPO_APP_VARIANT: variant } } });
      assert.equal(appConfig.android.softwareKeyboardLayoutMode, 'resize');
      const plugin = appConfig.plugins.find((entry: unknown) => typeof entry === 'function');
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
