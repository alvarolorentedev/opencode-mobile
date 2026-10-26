import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const SUPPORT_URL = 'https://getopencode.app/support/';
export const FEEDBACK_URL = 'https://github.com/alvarolorentedev/opencode-mobile/issues/new';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.getopencode';

// F-Droid builds have no Play Store listing to rate. iOS uses the App Store's
// native review flow, so it can offer rating even though there is no Play link.
export function hasPlayStoreRating() {
  return Platform.OS === 'android' && !Constants.expoConfig?.extra?.foss;
}

export function canRateApp() {
  return Platform.OS === 'ios' || hasPlayStoreRating();
}
