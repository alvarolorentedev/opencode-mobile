import * as Application from 'expo-application';

import type { AppUpdateApi, UpdateEvent } from '@/shared/platform/app-updates';

type NativeUpdateInfo = {
  updateAvailable?: boolean;
  updateInProgress?: boolean;
  downloaded?: boolean;
  storeVersion?: string | null;
  immediateAllowed?: boolean;
  flexibleAllowed?: boolean;
};

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
        native.addUpdateListener('updateDownloaded', () => listener?.({ phase: 'downloaded' })),
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
      const info = (await module.checkForUpdate()) as NativeUpdateInfo;
      if (info.updateInProgress) return { phase: 'inProgress', version: info.storeVersion ?? 'immediate' };
      // A flexible download that finished (possibly before a process death) waits for an explicit install.
      if (info.updateAvailable && info.downloaded) return { phase: 'downloaded', version: info.storeVersion ?? undefined };
      return info.updateAvailable && (info.immediateAllowed || info.flexibleAllowed)
        ? { phase: 'available', version: info.storeVersion ?? undefined } : { phase: 'none' };
    },
    start: async (isSafe) => {
      const module = await load();
      if (!module || !isSafe()) return false;
      // Prefer immediate; fall back to flexible when Play only permits that type.
      // A finished download completes, and an interrupted immediate flow resumes, on either call.
      // Native failures may open Play Store; the domain suppresses this attempt before handoff.
      if (await module.startUpdate(true)) return true;
      return isSafe() ? module.startUpdate(false) : false;
    },
    subscribe: (callback) => {
      listener = callback;
      return () => { listener = undefined; subscriptions.forEach((remove) => remove()); subscriptions = []; };
    },
  };
}
