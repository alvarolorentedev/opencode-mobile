import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export type VoiceInputPermission = {
  granted: boolean;
  canAskAgain: boolean;
  restricted: boolean;
  available: boolean;
};

const UNAVAILABLE: VoiceInputPermission = { granted: false, canAskAgain: false, restricted: false, available: false };

// Android runtime-permission activities pause the host activity, which React
// Native reports as AppState "background". Voice surfaces ignore that window
// so a first-time permission grant cannot cancel the capture it is enabling.
let permissionPrompts = 0;

export function isVoicePermissionPromptActive() {
  return permissionPrompts > 0;
}

function waitForActiveApp(timeoutMs = 1500): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let subscription: { remove(): void } | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish();
    });
  });
}

async function promptForPermission<T>(request: () => Promise<T>): Promise<T> {
  permissionPrompts++;
  try {
    const result = await request();
    await waitForActiveApp();
    return result;
  } finally {
    permissionPrompts--;
  }
}

function toPermission(result: { granted?: boolean; canAskAgain?: boolean; restricted?: boolean } | undefined): VoiceInputPermission {
  if (!result) {
    return UNAVAILABLE;
  }

  return {
    granted: Boolean(result.granted),
    canAskAgain: Boolean(result.canAskAgain),
    restricted: Boolean(result.restricted),
    available: true,
  };
}

/**
 * Reads the current microphone/speech-recognition permission without prompting.
 * Safe to call on mount; voice setup stays optional.
 */
export async function getVoiceInputPermissionAsync(): Promise<VoiceInputPermission> {
  try {
    return toPermission(await ExpoSpeechRecognitionModule.getPermissionsAsync());
  } catch {
    return UNAVAILABLE;
  }
}

/** Prompts for microphone/speech-recognition permission when needed. */
export async function requestVoiceInputPermissionAsync(): Promise<VoiceInputPermission> {
  try {
    return toPermission(await promptForPermission(() => ExpoSpeechRecognitionModule.requestPermissionsAsync()));
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Reads first so an already-granted permission never opens the Android
 * permission activity. Voice starts call this instead of requesting blindly.
 */
export async function ensureVoiceInputPermissionAsync(): Promise<VoiceInputPermission> {
  const current = await getVoiceInputPermissionAsync();
  if (current.granted || current.restricted || (current.available && !current.canAskAgain)) return current;
  return requestVoiceInputPermissionAsync();
}

/**
 * Opens the app's own system settings page, where microphone and speech
 * recognition access can be restored after a denial. iOS has no supported deep
 * link into Siri or Dictation settings, so those remain text guidance.
 */
export async function openVoiceSettingsAsync(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}

// Local PCM input needs microphone access, without requiring OS speech recognition.
export async function getLocalVoicePermissionAsync() {
  try { return toPermission(await getRecordingPermissionsAsync()); } catch { return UNAVAILABLE; }
}
export async function requestLocalVoicePermissionAsync() {
  try { return toPermission(await promptForPermission(() => requestRecordingPermissionsAsync())); } catch { return UNAVAILABLE; }
}
export async function ensureLocalVoicePermissionAsync() {
  const current = await getLocalVoicePermissionAsync();
  if (current.granted || current.restricted || (current.available && !current.canAskAgain)) return current;
  return requestLocalVoicePermissionAsync();
}
