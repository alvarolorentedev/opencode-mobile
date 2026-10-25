import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyGradleProperties, withAndroidAppConfig } = require('../../config/plugins/android.cjs') as {
  applyGradleProperties: (items: any[]) => any[];
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
  it('replaces Gradle memory and R8 properties without touching unrelated items', () => {
    const items = [
      { type: 'property', key: 'org.gradle.jvmargs', value: 'old' },
      { type: 'property', key: 'android.r8.optimizedResourceShrinking', value: 'false' },
      { type: 'property', key: 'keep.me', value: 'yes' },
      { type: 'comment', value: 'keep' },
    ];
    expect(applyGradleProperties(items)).toEqual([
      { type: 'property', key: 'keep.me', value: 'yes' },
      { type: 'comment', value: 'keep' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8' },
      { type: 'property', key: 'android.r8.optimizedResourceShrinking', value: 'true' },
    ]);
  });

  it('overrides the ML Kit scanner orientation only in non-FOSS builds', async () => {
    const production = withAndroidAppConfig(androidConfig(), { isDevelopmentVariant: true, isFossVariant: false });
    const manifest = { manifest: { application: [{ $: {} }] } };
    const result = await production.mods.android.manifest({ ...production, modResults: manifest });
    const application = result.modResults.manifest.application[0];
    expect(application.$['android:usesCleartextTraffic']).toBe('true');
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
