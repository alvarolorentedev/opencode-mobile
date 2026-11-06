import * as Application from 'expo-application';

import type { AppUpdateApi, UpdateEvent } from '@/shared/platform/app-updates';

type NativeUpdateInfo = {
  updateAvailable?: boolean;
  updateInProgress?: boolean;
  downloaded?: boolean;
  storeVersion?: string | null;
  immediateAllowed?: boolean;
  flexibleAllowed?: boolean;
  serverPriority?: number | null;
};

export function createAndroidAppUpdates(): AppUpdateApi {
  let listener: ((event: UpdateEvent) => void) | undefined;
  let subscriptions: (() => void)[] = [];
  let native: typeof import('expo-in-app-updates') | undefined;
  // Chosen from the last check: Play reports the highest priority across skipped versions and tracks.
  let eligible = { immediate: false, flexible: false, downloaded: false, urgent: false };

  async function load() {
    // Only the Play-installed production boundary can reach this adapter. The
    // verification runs once per session: a transient Play referrer failure must
    // not silently abort an install that is already safe to hand off.
    if (!native) {
      try { await Application.getInstallReferrerAsync(); } catch { return undefined; }
      native = await import('expo-in-app-updates');
    }
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
      const recovering = Boolean(info.updateInProgress);
      eligible = {
        immediate: Boolean(info.immediateAllowed) || recovering,
        flexible: Boolean(info.flexibleAllowed) && !recovering,
        downloaded: Boolean(info.downloaded),
        // Play priorities 4-5 mark a release as urgent; those keep the blocking flow.
        urgent: recovering || (info.serverPriority ?? 0) >= 4,
      };
      if (recovering) return { phase: 'inProgress', version: info.storeVersion ?? 'immediate' };
      // A flexible download that finished (possibly before a process death) waits for an explicit install.
      if (info.updateAvailable && info.downloaded) return { phase: 'downloaded', version: info.storeVersion ?? undefined };
      return info.updateAvailable && (eligible.immediate || eligible.flexible)
        ? { phase: 'available', version: info.storeVersion ?? undefined } : { phase: 'none' };
    },
    start: async (isSafe) => {
      const module = await load();
      if (!module || !isSafe()) return false;
      // Native completion of a finished download and resume of an interrupted immediate flow ignore the requested type.
      if (eligible.downloaded) return module.startUpdate(false);
      const order = eligible.urgent ? [true, false] : [false, true];
      for (const immediate of order) {
        if (immediate ? !eligible.immediate : !eligible.flexible) continue;
        if (await module.startUpdate(immediate)) return true;
        // Native failures may open Play Store; the domain suppresses this attempt before handoff.
        if (!isSafe()) return false;
      }
      return false;
    },
    subscribe: (callback) => {
      listener = callback;
      return () => { listener = undefined; subscriptions.forEach((remove) => remove()); subscriptions = []; };
    },
  };
}
