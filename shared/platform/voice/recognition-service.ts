import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// A native start attempt can be retried with safer Android options. The
// compatibility attempt avoids the library's custom AudioRecord path and the
// on-device formatter; the service attempt also selects a known Google
// recognizer instead of an OEM default that may never answer.
export type StartAttempt = {
  compatibility?: boolean;
  forceNetwork?: boolean;
  servicePackage?: string;
};

type RecognitionServiceContext = {
  apiLevel: number;
  defaultService?: string;
  platform: string;
  services: string[];
};

const GOOGLE_RECOGNITION_SERVICES = ['com.google.android.tts', 'com.google.android.googlequicksearchbox'];

export function preferredGoogleRecognitionPackage({
  apiLevel,
  defaultService,
  services,
}: Omit<RecognitionServiceContext, 'platform'>): string | undefined {
  const ordered = apiLevel >= 33 ? GOOGLE_RECOGNITION_SERVICES : [...GOOGLE_RECOGNITION_SERVICES].reverse();
  return ordered.find((packageName) => packageName !== defaultService && services.includes(packageName));
}

/**
 * Returns the next recovery attempt for an Android session that never started.
 * Other platforms only need the start watchdog because they do not use the
 * Android custom audio recorder or an OEM recognizer default.
 */
export function nextStartAttempt(
  current: StartAttempt,
  context: RecognitionServiceContext,
): StartAttempt | undefined {
  if (context.platform !== 'android') {
    return undefined;
  }
  if (!current.compatibility) {
    return { ...current, compatibility: true, forceNetwork: true };
  }
  if (!current.servicePackage) {
    const servicePackage = preferredGoogleRecognitionPackage(context);
    if (servicePackage) {
      return { ...current, compatibility: true, forceNetwork: true, servicePackage };
    }
  }
  return undefined;
}

/** Reads the Android recognizer defaults without prompting or throwing. */
export function readRecognitionServices(): Omit<RecognitionServiceContext, 'platform'> {
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;
  if (Platform.OS !== 'android') {
    return { apiLevel, services: [] };
  }
  try {
    const services = ExpoSpeechRecognitionModule.getSpeechRecognitionServices();
    const defaultService = ExpoSpeechRecognitionModule.getDefaultRecognitionService()?.packageName || undefined;
    return { apiLevel, defaultService, services: Array.isArray(services) ? services : [] };
  } catch {
    return { apiLevel, services: [] };
  }
}
