import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyGradleProperties, withAndroidAppConfig } = require('../../config/plugins/android.cjs') as {
  applyGradleProperties: (items: any[], options?: { isDevelopmentVariant?: boolean }) => any[];
  withAndroidAppConfig: (config: any, options: { isDevelopmentVariant: boolean; isFossVariant: boolean }) => any;
};
const { withoutPushEntitlement } = require('../../config/plugins/ios.cjs') as {
  withoutPushEntitlement: (config: any) => any;
};

function androidConfig() {
  return {
    name: 'Test',
    slug: 'test',
    mods: { android: {} },
    modRequest: { projectRoot: '/tmp/project' },
  };
}

describe('Expo config plugins', () => {
  it('replaces Gradle memory properties without touching unrelated items', () => {
    const items = [
      { type: 'property', key: 'org.gradle.jvmargs', value: 'old' },
      { type: 'property', key: 'rnllamaBuildFromSource', value: 'true' },
      { type: 'property', key: 'keep.me', value: 'yes' },
      { type: 'comment', value: 'keep' },
    ];
    expect(applyGradleProperties(items, { isDevelopmentVariant: false })).toEqual([
      { type: 'property', key: 'keep.me', value: 'yes' },
      { type: 'comment', value: 'keep' },
      { type: 'property', key: 'rnllamaBuildFromSource', value: 'false' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8' },
      { type: 'property', key: 'org.gradle.caching', value: 'true' },
      { type: 'property', key: 'AsyncStorage_db_size_in_MB', value: '64' },
      { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' },
    ]);
  });

  it('leaves development ABIs untouched', () => {
    const items = [
      { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' },
    ];
    const result = applyGradleProperties(items, { isDevelopmentVariant: true });
    expect(result).toContainEqual({
      type: 'property',
      key: 'AsyncStorage_db_size_in_MB',
      value: '64',
    });
    expect(result).toContainEqual({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'armeabi-v7a,arm64-v8a,x86,x86_64',
    });
  });

  it('overrides the ML Kit scanner orientation only in non-FOSS builds', async () => {
    const production = withAndroidAppConfig(androidConfig(), { isDevelopmentVariant: true, isFossVariant: false });
    const manifest = { manifest: { application: [{ $: {} }] } };
    const result = await production.mods.android.manifest({ ...production, modResults: manifest });
    const application = result.modResults.manifest.application[0];
    expect(application.activity).toContainEqual({
      $: {
        'android:name': 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity',
        'android:screenOrientation': 'unspecified',
        'tools:replace': 'android:screenOrientation',
      },
    });

    const foss = withAndroidAppConfig(androidConfig(), { isDevelopmentVariant: true, isFossVariant: true });
    const fossResult = await foss.mods.android.manifest({ ...foss, modResults: { manifest: { application: [{ $: {} }] } } });
    expect(fossResult.modResults.manifest.application[0].activity).toBeUndefined();
  });

  it('removes the push entitlement while preserving other entitlements', async () => {
    const config = { mods: { ios: {} } };
    const plugin = withoutPushEntitlement(config);
    const result = await plugin.mods.ios.entitlements({
      ...plugin,
      modResults: { 'aps-environment': 'development', 'com.apple.developer.associated-domains': ['applinks:example.test'] },
    });
    expect(result.modResults).toEqual({ 'com.apple.developer.associated-domains': ['applinks:example.test'] });
  });
});
