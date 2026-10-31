import * as Application from 'expo-application';

import type { AppUpdateApi, UpdateEvent } from '@/shared/platform/app-updates';

export function createAndroidAppUpdates(): AppUpdateApi {
  let listener: ((event: UpdateEvent) => void) | undefined;
  let subscriptions: (() => void)[] = [];
  let native: typeof import('expo-in-app-updates') | undefined;

  async function load() {
    // Only the Play-installed production boundary can reach this adapter.
    try { await Application.getInstallReferrerAsync(); } catch { return undefined; }
    native ??= await import('expo-in-app-updates');
    if (listener && !subscriptions.length) {
      subscriptions = [
        native.addUpdateListener('updateCancelled', () => listener?.({ phase: 'cancelled' })),
        native.addUpdateListener('updateCompleted', () => listener?.({ phase: 'none' })),
      ];
    }
    return native;
  }

  return {
    nativeConsent: true,
    supportsRecovery: true,
    check: async () => {
      const module = await load();
      if (!module) return { phase: 'none' };
      const info = await module.checkForUpdate();
      if (info.updateInProgress) return { phase: 'inProgress', version: info.storeVersion ?? 'immediate' };
      return info.updateAvailable && info.immediateAllowed
        ? { phase: 'available', version: info.storeVersion ?? undefined } : { phase: 'none' };
    },
    start: async (isSafe) => {
      const module = await load();
      if (!module || !isSafe()) return false;
      // Passing true is essential: checkAndStartUpdate can silently choose flexible mode.
      // Native failures may open Play Store; the domain suppresses this attempt before handoff.
      return module.startUpdate(true);
    },
    subscribe: (callback) => {
      listener = callback;
      return () => { listener = undefined; subscriptions.forEach((remove) => remove()); subscriptions = []; };
    },
  };
}
