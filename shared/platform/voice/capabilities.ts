import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { getVoiceInputPermissionAsync, type VoiceInputPermission } from '@/shared/platform/voice/permissions';

export type VoiceCapabilities = {
  permission: VoiceInputPermission;
  recognitionAvailable: boolean;
  onDeviceSupported: boolean;
};

/**
 * Read-only snapshot of the device's voice-input capabilities, used by the
 * onboarding step and the Settings voice check. Never prompts.
 */
export async function getVoiceCapabilitiesAsync(): Promise<VoiceCapabilities> {
  const permission = await getVoiceInputPermissionAsync();

  let recognitionAvailable = false;
  let onDeviceSupported = false;

  try {
    recognitionAvailable = ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    recognitionAvailable = false;
  }

  try {
    onDeviceSupported = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch {
    onDeviceSupported = false;
  }

  return { permission, recognitionAvailable, onDeviceSupported };
}
