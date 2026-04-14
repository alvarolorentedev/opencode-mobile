import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';

function toUserMessage(event: ExpoSpeechRecognitionErrorEvent) {
  switch (event.error) {
    case 'not-allowed':
      return 'Microphone or speech recognition permission was denied.';
    case 'language-not-supported':
      return 'This language is not available for on-device voice input.';
    case 'service-not-allowed':
      return 'Voice input is unavailable on this device right now.';
    case 'network':
      return 'Voice input fell back to network speech recognition and failed.';
    case 'no-speech':
    case 'speech-timeout':
      return 'No speech detected. Try again in a quieter spot.';
    case 'busy':
      return 'Voice input is already running.';
    default:
      return event.message || 'Voice input failed.';
  }
}

export function useSpeechInput({
  locale,
  onResult,
  preferOnDevice,
}: {
  locale?: string;
  preferOnDevice: boolean;
  onResult: (transcript: string, isFinal: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const [isListening, setIsListening] = useState(false);
  const [supportsLocalRecognition] = useState(() => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition());
  const [isAvailable] = useState(() => ExpoSpeechRecognitionModule.isRecognitionAvailable());
  const [level, setLevel] = useState(0);

  useSpeechRecognitionEvent('start', () => {
    setError(undefined);
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    setLevel(0);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    onResult(transcript, event.isFinal);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setError(toUserMessage(event));
    setIsListening(false);
    setLevel(0);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    setLevel(Math.max(0, event.value));
  });

  const start = useCallback(async (options?: { continuous?: boolean }) => {
    setError(undefined);

    if (!isAvailable) {
      setError('Voice input is unavailable on this device.');
      return false;
    }

    if (preferOnDevice && !supportsLocalRecognition) {
      setError('On-device voice input is not available on this device yet.');
      return false;
    }

    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      setError('Microphone or speech recognition permission was denied.');
      return false;
    }

    ExpoSpeechRecognitionModule.start({
      addsPunctuation: true,
      continuous: options?.continuous ?? Platform.OS !== 'ios',
      interimResults: true,
      iosTaskHint: 'dictation',
      lang: locale || 'en-US',
      requiresOnDeviceRecognition: preferOnDevice,
      volumeChangeEventOptions: {
        enabled: true,
        intervalMillis: 120,
      },
    });

    return true;
  }, [isAvailable, locale, preferOnDevice, supportsLocalRecognition]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const abort = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setIsListening(false);
    setLevel(0);
  }, []);

  return useMemo(
    () => ({
      abort,
      error,
      isAvailable,
      isListening,
      level,
      start,
      stop,
      supportsLocalRecognition,
    }),
    [abort, error, isAvailable, isListening, level, start, stop, supportsLocalRecognition],
  );
}
