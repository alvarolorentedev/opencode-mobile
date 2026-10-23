import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

function reportHapticFailure(error: unknown) {
  if (__DEV__) {
    console.warn('[haptics] feedback failed', error);
  }
}

// Android's light impact is a raw 50 ms vibration at 30% amplitude, which is
// imperceptible on phones with a weak motor or reduced touch vibration. Prefer
// the system's confirmation effect, then keep the light impact as a fallback
// for older API levels, and finally use a raw vibration when the haptics
// module itself is unavailable (for example in an older development client).
async function androidCodeCopyHaptic() {
  try {
    await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
    return;
  } catch {
    // Older API levels do not expose CONFIRM; continue to the light impact.
  }

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    return;
  } catch (error) {
    reportHapticFailure(error);
  }

  Vibration.vibrate(20);
}

// Code-block copy is a lightweight acknowledgement, distinct from the success
// notification used when copying a whole message.
export function codeCopyHaptic() {
  if (Platform.OS === 'android') {
    void androidCodeCopyHaptic();
    return;
  }

  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(reportHapticFailure);
}
