import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/** Synchronous capability probe shared by the voice hook and Settings check. */
export function readVoiceCapabilityFlags(): { recognitionAvailable: boolean; onDeviceSupported: boolean } {
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
  return { recognitionAvailable, onDeviceSupported };
}
