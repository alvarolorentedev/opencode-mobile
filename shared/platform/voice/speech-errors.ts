import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';

// A recovery action a UI surface can offer next to a voice-input error.
// - `retry`: trying again can plausibly succeed (transient failure, or the
//   permission prompt still has a chance to appear).
// - `open-settings`: the user must change OS/app settings, so deep-link them.
// - `none`: nothing actionable; the reason is environmental (restricted).
export type VoiceRecoveryAction = 'none' | 'open-settings' | 'retry';

export type VoiceInputErrorInfo = {
  action: VoiceRecoveryAction;
  message: string;
  retryable: boolean;
};

export type VoiceInputErrorContext = {
  canAskAgain: boolean;
  onDeviceRequested: boolean;
  restricted: boolean;
};

// iOS surfaces a missing on-device language model, or Siri/Dictation being
// disabled, as `service-not-allowed`; a locale that only exists in the cloud can
// report `language-not-supported`. Both can succeed again through the network
// recognizer, so they are worth one automatic retry without on-device.
const ON_DEVICE_FALLBACK_CODES: ReadonlySet<string> = new Set(['language-not-supported', 'service-not-allowed']);

export function canFallbackToNetwork(errorCode: string | undefined, onDeviceRequested: boolean): boolean {
  return Boolean(onDeviceRequested && errorCode && ON_DEVICE_FALLBACK_CODES.has(errorCode));
}

/**
 * Turns a native speech-recognition error into a user message plus the action a
 * recovery surface should offer. Pure so it can be unit-tested without a device.
 */
export function describeVoiceInputError(
  errorCode: ExpoSpeechRecognitionErrorCode | undefined,
  nativeMessage: string | undefined,
  context: VoiceInputErrorContext,
): VoiceInputErrorInfo {
  switch (errorCode) {
    case 'not-allowed':
      if (context.restricted) {
        return {
          action: 'none',
          message: 'Speech recognition is restricted by device policy. Contact your device administrator.',
          retryable: false,
        };
      }
      if (context.canAskAgain) {
        return {
          action: 'retry',
          message: 'Microphone or speech recognition access is needed for voice input. Try again to allow it.',
          retryable: true,
        };
      }
      return {
        action: 'open-settings',
        message: 'Microphone or speech recognition access was denied. Enable it in Settings, then try again.',
        retryable: false,
      };
    case 'service-not-allowed':
      return {
        action: 'retry',
        message: 'Speech recognition is unavailable right now. Turn on Siri & Dictation in Settings, then try again.',
        retryable: true,
      };
    case 'language-not-supported':
      return {
        action: 'none',
        message: 'This language is not available for voice input on this device. Pick another speech locale.',
        retryable: false,
      };
    case 'network':
      return {
        action: 'retry',
        message: 'Voice input lost its connection. Check your network and try again.',
        retryable: true,
      };
    case 'audio-capture':
    case 'interrupted':
      return {
        action: 'retry',
        message: 'Voice input was interrupted. Try again.',
        retryable: true,
      };
    case 'busy':
      return {
        action: 'retry',
        message: 'Voice input is already running.',
        retryable: true,
      };
    case 'no-speech':
    case 'speech-timeout':
      return {
        action: 'retry',
        message: 'No speech detected. Try again in a quieter spot.',
        retryable: true,
      };
    default:
      return {
        action: 'retry',
        message: nativeMessage || 'Voice input failed. Try again.',
        retryable: true,
      };
  }
}
