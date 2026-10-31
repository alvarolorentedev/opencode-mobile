import { describe, expect, it } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

// Mirrors the enum exposed by expo-application; kept literal so the loader can
// run the helper without native modules.
const ApplicationReleaseType = { UNKNOWN: 0, SIMULATOR: 1, ENTERPRISE: 2, DEVELOPMENT: 3, AD_HOC: 4, APP_STORE: 5 };

async function storeInstall({ platform, enabled = true, releaseType, releaseError, referrer, referrerError }: {
  platform: string;
  enabled?: boolean;
  releaseType?: number;
  releaseError?: Error;
  referrer?: string;
  referrerError?: Error;
}) {
  const calls = { releaseType: 0, referrer: 0 };
  const { isConnectStoreInstall } = await loadTs('shared/platform/install-identity.ts', {
    'expo-application': {
      ApplicationReleaseType,
      getIosApplicationReleaseTypeAsync: async () => {
        calls.releaseType += 1;
        if (releaseError) throw releaseError;
        return releaseType;
      },
      getInstallReferrerAsync: async () => {
        calls.referrer += 1;
        if (referrerError) throw referrerError;
        return referrer;
      },
    },
    'react-native': { Platform: { OS: platform } },
    "@/shared/contracts/cloud-link": { isConnectEnabled: () => enabled }
  });
  return { isConnectStoreInstall: (value?: string) => isConnectStoreInstall(value), calls };
}

describe('Cloud Link store-install availability', () => {
  it('hides the section whenever Cloud Link is disabled (FOSS and production web)', async () => {
    for (const platform of ['ios', 'android', 'web']) {
      const { isConnectStoreInstall, calls } = await storeInstall({ platform, enabled: false, releaseType: ApplicationReleaseType.APP_STORE, referrer: 'utm_source=google-play' });
      expect(await isConnectStoreInstall(), platform).toBe(false);
      expect(calls).toEqual({ releaseType: 0, referrer: 0 });
    }
  });

  it('shows the section for App Store installs only', async () => {
    const appStore = await storeInstall({ platform: 'ios', releaseType: ApplicationReleaseType.APP_STORE });
    expect(await appStore.isConnectStoreInstall()).toBe(true);
    const development = await storeInstall({ platform: 'ios', releaseType: ApplicationReleaseType.DEVELOPMENT });
    expect(await development.isConnectStoreInstall()).toBe(false);
    const failed = await storeInstall({ platform: 'ios', releaseError: new Error('unavailable') });
    expect(await failed.isConnectStoreInstall()).toBe(false);
  });

  it('shows the section when the Play Install Referrer service answers', async () => {
    const organic = await storeInstall({ platform: 'android', referrer: 'utm_source=google-play&utm_medium=organic' });
    expect(await organic.isConnectStoreInstall()).toBe(true);
    const managed = await storeInstall({ platform: 'android', referrer: '' });
    expect(await managed.isConnectStoreInstall()).toBe(true);
  });

  it('hides the section for directly installed APKs where the service refuses the package', async () => {
    const sideloaded = await storeInstall({ platform: 'android', referrerError: new Error('ERR_APPLICATION_INSTALL_REFERRER: response code 3') });
    expect(await sideloaded.isConnectStoreInstall()).toBe(false);
    expect(sideloaded.calls.referrer).toBe(1);
  });

  it('resolves the web E2E harness and nothing else on web or unknown platforms', async () => {
    const web = await storeInstall({ platform: 'web' });
    expect(await web.isConnectStoreInstall()).toBe(true);
    expect(web.calls).toEqual({ releaseType: 0, referrer: 0 });
    expect(await web.isConnectStoreInstall('windows')).toBe(false);
  });
});
