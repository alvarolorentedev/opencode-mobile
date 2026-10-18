import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/i18n.test.mjs Node script. The loose mode
// that the old `--allow-missing` flag enabled is now driven by
// `I18N_ALLOW_MISSING=1` (npm run test:i18n:loose), since Vitest owns argument
// parsing for the suite.
describe('i18n locale contract', () => {
  it('keeps locales, plurals, the generated registry, and app.config in sync', async () => {
    const root = new URL('../../', import.meta.url);
    const localesDir = fileURLToPath(new URL('lib/i18n/locales', root));

    const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
    const INTERPOLATION_PATTERN = /{{\s*([^},\s]+)[^}]*}}/g;

    function flatten(value: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
      for (const [key, child] of Object.entries(value)) {
        const nextKey = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          flatten(child as Record<string, unknown>, nextKey, out);
        } else {
          out[nextKey] = child;
        }
      }
      return out;
    }

    function interpolations(value: unknown) {
      const found = new Set<string>();
      if (typeof value !== 'string') {
        return found;
      }
      for (const match of value.matchAll(INTERPOLATION_PATTERN)) {
        found.add(match[1]);
      }
      return found;
    }

    function pluralBase(key: string) {
      const index = key.lastIndexOf('_');
      if (index === -1) {
        return undefined;
      }
      const suffix = key.slice(index + 1);
      return PLURAL_SUFFIXES.includes(suffix) ? key.slice(0, index) : undefined;
    }

    async function readJson(filePath: string) {
      return JSON.parse(await readFile(filePath, 'utf8'));
    }

    async function loadLanguages() {
      const entries = await readdir(localesDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    }

    const languages = await loadLanguages();
    assert.ok(languages.includes('en'), 'English (en) must exist as the source locale.');

    const namespaces = (await readdir(path.join(localesDir, 'en')))
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort();

    assert.ok(namespaces.length > 0, 'English must define at least one namespace.');

    const sourceFlat: Record<string, Record<string, unknown>> = {};
    for (const namespace of namespaces) {
      sourceFlat[namespace] = flatten(await readJson(path.join(localesDir, 'en', `${namespace}.json`)));
    }

    // `I18N_ALLOW_MISSING=1` (npm run test:i18n:loose) is a local-iteration escape
    // hatch: keys absent from a non-English locale fall back to English at runtime,
    // so WIP strings do not force eight file edits. CI runs without it and enforces
    // full parity.
    const allowMissing = process.env.I18N_ALLOW_MISSING === '1';
    const missingKeySummary: string[] = [];

    for (const language of languages) {
      if (language === 'en') {
        continue;
      }

      const requiredPlurals = new Set(
        new Intl.PluralRules(language).resolvedOptions().pluralCategories,
      );

      for (const namespace of namespaces) {
        const languageFlat = flatten(await readJson(path.join(localesDir, language, `${namespace}.json`)));
        const sourceKeys = Object.keys(sourceFlat[namespace]).sort();
        const languageKeys = Object.keys(languageFlat).sort();

        const missing = sourceKeys.filter((key) => !(key in languageFlat));
        const extra = languageKeys.filter((key) => !(key in sourceFlat[namespace]));
        if (allowMissing) {
          if (missing.length > 0) {
            missingKeySummary.push(`${language}/${namespace} (${missing.length})`);
          }
        } else {
          assert.equal(missing.length, 0, `${language}/${namespace} is missing keys: ${missing.join(', ')}`);
        }
        assert.equal(extra.length, 0, `${language}/${namespace} has unknown keys: ${extra.join(', ')}`);

        for (const key of sourceKeys) {
          // In loose mode a missing key is a runtime English fallback, not a
          // translation bug, so skip its value/interpolation checks.
          if (!(key in languageFlat)) {
            continue;
          }
          const sourceVars = interpolations(sourceFlat[namespace][key]);
          const languageVars = interpolations(languageFlat[key]);
          assert.deepEqual(
            [...languageVars].sort(),
            [...sourceVars].sort(),
            `${language}/${namespace}.${key} has mismatched interpolation variables.`,
          );

          const base = pluralBase(key);
          if (base && languageFlat[key]) {
            const siblingCategories = new Set(
              languageKeys
                .filter((candidate) => pluralBase(candidate) === base)
                .map((candidate) => candidate.slice(base.length + 1)),
            );
            for (const category of requiredPlurals) {
              assert.ok(
                siblingCategories.has(category),
                `${language}/${namespace}.${base} is missing required plural category "${category}".`,
              );
            }
          }
        }
      }
    }

    // resolveLanguage is pure and import-free, so transpile and import it directly.
    const languagesSource = await readFile(new URL('lib/i18n/languages.ts', root), 'utf8');
    const languagesOutput = ts.transpileModule(languagesSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const { resolveLanguage, SUPPORTED_LANGUAGE_CODES } = await import(
      `data:text/javascript,${encodeURIComponent(languagesOutput)}`
    );

    assert.equal(resolveLanguage(undefined, ['en-US']), 'en', 'en-US device tag resolves to en.');
    assert.equal(resolveLanguage('es', ['fr-FR']), 'es', 'Supported preference wins over the device.');
    assert.equal(resolveLanguage(undefined, ['pt-BR']), 'pt', 'Device region tag resolves by base language.');
    assert.equal(resolveLanguage(undefined, ['zh-Hans-CN']), 'zh', 'Device tag resolves by base language for script tags.');
    assert.equal(resolveLanguage('ru', ['xx-YY']), 'en', 'Unsupported preference and device fall back to en.');
    assert.equal(resolveLanguage(undefined, ['xx-YY']), 'en', 'Unsupported device language falls back to en.');
    assert.equal(resolveLanguage('EN', []), 'en', 'Preference matching is case-insensitive.');
    assert.ok(SUPPORTED_LANGUAGE_CODES.includes('en'), 'English must be a supported language.');
    assert.ok(SUPPORTED_LANGUAGE_CODES.length >= 2, 'At least one non-English language must be supported.');

    // --- registry and config stay in sync with the locale folders ---------------

    const sortedCodes = [...SUPPORTED_LANGUAGE_CODES].sort();
    assert.deepEqual(
      languages,
      sortedCodes,
      'Every SUPPORTED_LANGUAGES entry needs a locales/<code> folder, and vice versa.',
    );

    // The bundled registry is generated from the folders, so a stale file means a
    // language or namespace changed without regenerating.
    const { buildResourcesSource } = await import(new URL('../../scripts/gen-i18n.mjs', import.meta.url));
    const resourcesSource = await readFile(new URL('lib/i18n/resources.ts', root), 'utf8');
    assert.equal(
      resourcesSource,
      await buildResourcesSource(),
      'lib/i18n/resources.ts is out of date; run `npm run gen:i18n`.',
    );

    const appConfigSource = await readFile(new URL('app.config.ts', root), 'utf8');
    const supportedLocalesBlock = appConfigSource.match(/supportedLocales:\s*\{([^}]*)\}/)?.[1];
    assert.ok(supportedLocalesBlock, 'app.config.ts must define supportedLocales.');
    const configLocaleLists = [...supportedLocalesBlock.matchAll(/(?:ios|android):\s*\[([^\]]*)\]/g)]
      .map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort());
    assert.ok(configLocaleLists.length >= 2, 'app.config.ts must expose ios and android supportedLocales.');
    for (const list of configLocaleLists) {
      assert.deepEqual(list, sortedCodes, 'app.config.ts supportedLocales must match SUPPORTED_LANGUAGES.');
    }

    if (allowMissing && missingKeySummary.length > 0) {
      console.warn(`i18n: incomplete locales fall back to English: ${missingKeySummary.join(', ')}`);
    }
  });
});
