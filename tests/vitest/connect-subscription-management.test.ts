import { describe, expect, it, vi } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

async function store(platform: string, packageName: string | undefined = 'app.getopencode.mobile.dev', enabled = true) {
  const deepLinkToSubscriptions = vi.fn(async () => {});
  const { openConnectSubscriptionManagement } = await loadTs('lib/connect-store.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { android: { package: packageName } } } },
    'react-native': { Platform: { OS: platform } },
    'expo-iap': { deepLinkToSubscriptions },
    '@/lib/connect': { isConnectEnabled: () => enabled, getConnectStore: () => platform === 'ios' ? 'apple' : 'google' },
  }, { Error });
  return { openConnectSubscriptionManagement, deepLinkToSubscriptions };
}

describe('Cloud Link store management', () => {
  it('opens iOS subscriptions without choosing a product', async () => {
    const { openConnectSubscriptionManagement, deepLinkToSubscriptions } = await store('ios');
    await openConnectSubscriptionManagement();
    expect(deepLinkToSubscriptions).toHaveBeenCalledWith();
  });

  it('opens Android subscriptions using the current app package without guessing a SKU', async () => {
    const { openConnectSubscriptionManagement, deepLinkToSubscriptions } = await store('android');
    await openConnectSubscriptionManagement();
    expect(deepLinkToSubscriptions).toHaveBeenCalledWith({ packageNameAndroid: 'app.getopencode.mobile.dev' });
  });

  it('reports missing Android identity and unsupported builds without opening the store', async () => {
    const missing = await store('android', '');
    await expect(missing.openConnectSubscriptionManagement()).rejects.toThrow('package is unavailable');
    expect(missing.deepLinkToSubscriptions).not.toHaveBeenCalled();
    const unsupported = await store('android', undefined, false);
    await expect(unsupported.openConnectSubscriptionManagement()).rejects.toThrow('require an iOS or Android');
    expect(unsupported.deepLinkToSubscriptions).not.toHaveBeenCalled();
  });
});
