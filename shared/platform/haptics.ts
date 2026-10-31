import * as Haptics from 'expo-haptics';

// Both the message bubble and fenced code blocks acknowledge a successful copy
// with the same success notification.
export function copyHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function longPressHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export { ImpactFeedbackStyle, impactAsync, selectionAsync } from 'expo-haptics';
