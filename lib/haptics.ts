import * as Haptics from 'expo-haptics';

// Code-block copy is a lightweight acknowledgement, distinct from the success
// notification used when copying a whole message.
export function codeCopyHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
