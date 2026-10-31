import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Transpile `features/onboarding/model/onboarding-state.ts` and resolve its `@/` alias import to
// the real key module so the migration logic under test is the production one.
// The `PersistenceStorage` import is type-only and is erased by the transpiler.
//
// Migrated from the standalone tests/onboarding.test.mjs Node script.
describe('onboarding state', () => {
  it('parses versions, decides completion, and migrates existing installs', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, '..', '..', '..');

    function transpile(source: string) {
      return ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText;
    }

    const storageKeysUri = `data:text/javascript,${encodeURIComponent(
      transpile(await readFile(path.join(root, 'shared/storage/keys.ts'), 'utf8')),
    )}`;
    const zodUri = `data:text/javascript,${encodeURIComponent(
      `import { z } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/zod/index.cjs')).href)}; export { z };`,
    )}`;

    const onboardingStateUri = `data:text/javascript,${encodeURIComponent(
      transpile(await readFile(path.join(root, 'features/onboarding/model/onboarding-state.ts'), 'utf8'))
        .replace(/from ['"]@\/shared\/storage\/keys['"]/g, `from ${JSON.stringify(storageKeysUri)}`)
        .replace(/from 'zod'/g, `from ${JSON.stringify(zodUri)}`),
    )}`;

    const {
      CURRENT_ONBOARDING_VERSION,
      ONBOARDING_VERSION_IN_PROGRESS,
      hasExistingConfiguration,
      isOnboardingComplete,
      loadOnboardingStatus,
      parseOnboardingVersion,
      resolveOnboardingStatus,
      serializeOnboardingVersion,
    } = await import(onboardingStateUri);

    const { ONBOARDING_VERSION_STORAGE_KEY, SETTINGS_STORAGE_KEY, CONNECTION_PROFILES_STORAGE_KEY, ACTIVE_PROJECT_STORAGE_KEY } =
      await import(storageKeysUri);

    // --- parser / serializer ---------------------------------------------------

    assert.equal(parseOnboardingVersion(serializeOnboardingVersion(1)), 1);
    assert.equal(parseOnboardingVersion('3'), 3, 'a bare number is accepted for forward compatibility');
    assert.equal(parseOnboardingVersion('{"version":2}'), 2);
    assert.throws(() => parseOnboardingVersion('{'), /malformed/i);
    assert.throws(() => parseOnboardingVersion('"one"'), /invalid/i);
    assert.throws(() => parseOnboardingVersion('-1'), /invalid/i);
    assert.throws(() => parseOnboardingVersion('{"version":"1"}'), /invalid/i);

    assert.equal(isOnboardingComplete(0), false);
    assert.equal(isOnboardingComplete(CURRENT_ONBOARDING_VERSION), true);
    assert.equal(isOnboardingComplete(CURRENT_ONBOARDING_VERSION + 1), true);
    assert.equal(isOnboardingComplete(undefined), false);

    assert.equal(hasExistingConfiguration({ hasStoredSettings: false, hasStoredProfiles: false, hasActiveProject: false }), false);
    assert.equal(hasExistingConfiguration({ hasStoredSettings: true, hasStoredProfiles: false, hasActiveProject: false }), true);
    assert.equal(hasExistingConfiguration({ hasStoredSettings: false, hasStoredProfiles: true, hasActiveProject: false }), true);
    assert.equal(hasExistingConfiguration({ hasStoredSettings: false, hasStoredProfiles: false, hasActiveProject: true }), true);

    // --- pure migration decision ----------------------------------------------

    assert.deepEqual(
      resolveOnboardingStatus(undefined, { hasStoredSettings: false, hasStoredProfiles: false, hasActiveProject: false }),
      { completed: false, version: ONBOARDING_VERSION_IN_PROGRESS },
      'a fresh install starts onboarding and records version 0',
    );
    assert.deepEqual(
      resolveOnboardingStatus(undefined, { hasStoredSettings: true, hasStoredProfiles: false, hasActiveProject: false }),
      { completed: true, version: CURRENT_ONBOARDING_VERSION },
      'an existing settings key marks onboarding complete',
    );
    assert.deepEqual(
      resolveOnboardingStatus(0, { hasStoredSettings: true, hasStoredProfiles: true, hasActiveProject: true }),
      { completed: false, version: 0 },
      'an explicit in-progress marker is sticky even after configuration exists',
    );
    assert.deepEqual(
      resolveOnboardingStatus(CURRENT_ONBOARDING_VERSION, { hasStoredSettings: false, hasStoredProfiles: false, hasActiveProject: false }),
      { completed: true, version: CURRENT_ONBOARDING_VERSION },
    );

    // --- storage-backed resolution ---------------------------------------------

    function createStorage(initial = new Map<string, string>(), failedReads = new Set<string>()) {
      const removed: string[] = [];
      const values = new Map(initial);
      return {
        removed,
        values,
        async getItem(key: string) {
          if (failedReads.has(key)) throw new Error('read failed');
          return values.has(key) ? values.get(key) : null;
        },
        async removeItem(key: string) {
          removed.push(key);
          values.delete(key);
        },
      };
    }

    const fresh = await loadOnboardingStatus(createStorage());
    assert.deepEqual(fresh, { completed: false, version: 0 });

    const upgraded = await loadOnboardingStatus(createStorage(new Map([[SETTINGS_STORAGE_KEY, '{"serverUrl":"http://x"}']])));
    assert.deepEqual(upgraded, { completed: true, version: CURRENT_ONBOARDING_VERSION });

    const profilesOnly = await loadOnboardingStatus(createStorage(new Map([[CONNECTION_PROFILES_STORAGE_KEY, '[]']])));
    assert.equal(profilesOnly.completed, true);

    const activeOnly = await loadOnboardingStatus(createStorage(new Map([[ACTIVE_PROJECT_STORAGE_KEY, '/repo']])));
    assert.equal(activeOnly.completed, true);

    const sticky = await loadOnboardingStatus(createStorage(new Map([
      [ONBOARDING_VERSION_STORAGE_KEY, serializeOnboardingVersion(0)],
      [SETTINGS_STORAGE_KEY, '{"serverUrl":"http://x"}'],
    ])));
    assert.deepEqual(sticky, { completed: false, version: 0 });

    const done = await loadOnboardingStatus(createStorage(new Map([
      [ONBOARDING_VERSION_STORAGE_KEY, serializeOnboardingVersion(CURRENT_ONBOARDING_VERSION)],
    ])));
    assert.deepEqual(done, { completed: true, version: CURRENT_ONBOARDING_VERSION });

    const versionReadFailure = await loadOnboardingStatus(createStorage(
      new Map([[SETTINGS_STORAGE_KEY, '{}']]),
      new Set([ONBOARDING_VERSION_STORAGE_KEY]),
    ));
    assert.deepEqual(
      versionReadFailure,
      { completed: true, version: CURRENT_ONBOARDING_VERSION },
      'a storage failure never onboards an existing user',
    );

    const evidenceReadFailure = await loadOnboardingStatus(createStorage(new Map(), new Set([SETTINGS_STORAGE_KEY])));
    assert.deepEqual(evidenceReadFailure, { completed: true, version: CURRENT_ONBOARDING_VERSION });

    const malformed = await loadOnboardingStatus(createStorage(new Map([[ONBOARDING_VERSION_STORAGE_KEY, '{']])));
    assert.deepEqual(malformed, { completed: false, version: 0 });

    const malformedStorage = createStorage(new Map([[ONBOARDING_VERSION_STORAGE_KEY, '{']]));
    await loadOnboardingStatus(malformedStorage);
    assert.deepEqual(malformedStorage.removed, [ONBOARDING_VERSION_STORAGE_KEY], 'malformed marker is removed');
  });
});
