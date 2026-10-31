import { setAudioModeAsync } from 'expo-audio';

// The OS recognizer and the local PCM stream must never own the microphone at
// the same time. Conversation mode stops one before starting the other.
export async function activateLocalWakeRecordingAsync() {
  await setAudioModeAsync({
    allowsRecording: true,
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}

export async function deactivateLocalWakeRecordingAsync() {
  await setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}
