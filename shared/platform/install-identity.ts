import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { isConnectEnabled } from '@/shared/contracts/cloud-link';

// Cloud Link subscriptions are sold and managed through the App Store and
// Google Play only. Installs that did not come from those stores (directly
// installed APKs, F-Droid/FOSS builds, development or enterprise iOS builds)
// cannot complete a purchase, so Settings must not offer the section there.
//
// iOS exposes its release type directly. On Android the Play Install Referrer
// service only answers packages Google Play installed, so a resolved call is
// the install-source signal; some Play installs legitimately report an empty
// referrer, so its content is not inspected. Web resolves true only for the
// explicit development E2E harness that already enables Cloud Link through
// `connectPilot.testing`.
export async function isConnectStoreInstall(platform: string = Platform.OS): Promise<boolean> {
  if (!isConnectEnabled()) return false;
  if (platform === 'ios') {
    try { return await Application.getIosApplicationReleaseTypeAsync() === Application.ApplicationReleaseType.APP_STORE; }
    catch { return false; }
  }
  if (platform === 'android') {
    try { await Application.getInstallReferrerAsync(); return true; }
    catch { return false; }
  }
  return platform === 'web';
}
