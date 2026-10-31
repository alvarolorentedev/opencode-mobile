import * as Haptics from 'expo-haptics';

// Short cue so phrase detection is felt without touching the screen or
// interrupting playback.
export function playWakePhraseCue() {
  void Haptics.selectionAsync().catch(() => undefined);
}
