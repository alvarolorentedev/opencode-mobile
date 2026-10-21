import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, it } from 'vitest';

describe('iOS Personal Team config', () => {
  it('keeps normal signing config and only strips APNs when requested', async () => {
    const source = await readFile(new URL('../../app.config.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const loadConfig = (env: Record<string, string> = {}) => {
      const context = { exports: {}, require: createRequire(new URL('../../app.config.ts', import.meta.url)), process: { env } };
      runInNewContext(compiled, context);
      return (context.exports as { default: any }).default;
    };

    const production = loadConfig();
    assert.equal(production.ios.bundleIdentifier, 'app.getopencode.mobile');
    assert.ok(production.plugins.includes('expo-notifications'));
    assert.equal(production.plugins.some((plugin: unknown) => (plugin as Function).name === 'withoutPushEntitlement'), false);

    const personalTeam = loadConfig({
      EXPO_IOS_DISABLE_PUSH_ENTITLEMENT: '1',
      EXPO_IOS_BUNDLE_ID: 'com.example.opencode',
    });
    assert.equal(personalTeam.ios.bundleIdentifier, 'com.example.opencode');
    assert.equal(loadConfig({ EXPO_APP_VARIANT: 'development' }).ios.bundleIdentifier, 'app.getopencode.mobile.dev');
    assert.equal(loadConfig({ EXPO_APP_VARIANT: 'development', EXPO_IOS_BUNDLE_ID: 'com.example.dev' }).ios.bundleIdentifier, 'com.example.dev');
    const stripEntitlement = personalTeam.plugins.find((plugin: unknown) => (plugin as Function).name === 'withoutPushEntitlement');
    assert.equal(typeof stripEntitlement, 'function');

    const configured = (stripEntitlement as (config: any) => any)({});
    const result = await configured.mods.ios.entitlements({
      modResults: { 'aps-environment': 'development', 'com.apple.security.application-groups': ['group.example'] },
      ios: {},
    });
    assert.deepEqual({ ...result.modResults }, { 'com.apple.security.application-groups': ['group.example'] });
    assert.deepEqual({ ...result.ios.entitlements }, { 'com.apple.security.application-groups': ['group.example'] });
  });
});
