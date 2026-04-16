import { useCallback, useMemo, useRef, useState } from 'react';
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
  levelStep = 1,
  locale,
  onResult,
  preferOnDevice,
  volumeUpdateIntervalMillis = 120,
}: {
  levelStep?: number;
  locale?: string;
  preferOnDevice: boolean;
  onResult: (transcript: string, isFinal: boolean) => void;
  volumeUpdateIntervalMillis?: number;
}) {
  const [error, setError] = useState<string>();
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [supportsLocalRecognition] = useState(() => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition());
  const [isAvailable] = useState(() => ExpoSpeechRecognitionModule.isRecognitionAvailable());
  const [level, setLevel] = useState(0);
  const ignoreErrorsUntilRef = useRef(0);
  const lastLevelRef = useRef(0);

  const quantizeLevel = useCallback(
    (value: number) => {
      const safeStep = Math.max(0.25, levelStep);
      return Math.round(Math.max(0, value) / safeStep) * safeStep;
    },
    [levelStep],
  );

  const shouldIgnoreError = useCallback((event: ExpoSpeechRecognitionErrorEvent) => {
    if (event.error === 'aborted') {
      return true;
    }

    if (event.error === 'client' && Date.now() < ignoreErrorsUntilRef.current) {
      return true;
    }

    return false;
  }, []);

  useSpeechRecognitionEvent('start', () => {
    setError(undefined);
    setIsStarting(false);
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    setIsStarting(false);
    lastLevelRef.current = 0;
    setLevel(0);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    if (event.isFinal) {
      ignoreErrorsUntilRef.current = Date.now() + 1500;
    }

    onResult(transcript, event.isFinal);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setIsStarting(false);
    if (shouldIgnoreError(event)) {
      setIsListening(false);
      lastLevelRef.current = 0;
      setLevel(0);
      return;
    }

    setError(toUserMessage(event));
    setIsListening(false);
    lastLevelRef.current = 0;
    setLevel(0);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!isListening) {
      return;
    }

    const nextLevel = quantizeLevel(event.value);
    if (nextLevel === lastLevelRef.current) {
      return;
    }

    lastLevelRef.current = nextLevel;
    setLevel(nextLevel);
  });

  const start = useCallback(async (options?: { continuous?: boolean }) => {
    setError(undefined);
    setIsStarting(true);
    ignoreErrorsUntilRef.current = 0;

    if (!isAvailable) {
      setError('Voice input is unavailable on this device.');
      setIsStarting(false);
      return false;
    }

    if (preferOnDevice && !supportsLocalRecognition) {
      setError('On-device voice input is not available on this device yet.');
      setIsStarting(false);
      return false;
    }

    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      setError('Microphone or speech recognition permission was denied.');
      setIsStarting(false);
      return false;
    }

    try {
      ExpoSpeechRecognitionModule.start({
        addsPunctuation: true,
        continuous: options?.continuous ?? Platform.OS !== 'ios',
        interimResults: true,
        iosTaskHint: 'dictation',
        lang: locale || 'en-US',
        requiresOnDeviceRecognition: preferOnDevice,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: volumeUpdateIntervalMillis,
        },
      });

      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Voice input failed to start.');
      return false;
    } finally {
      setIsStarting(false);
    }
  }, [isAvailable, locale, preferOnDevice, supportsLocalRecognition, volumeUpdateIntervalMillis]);

  const stop = useCallback(() => {
    ignoreErrorsUntilRef.current = Date.now() + 1500;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Ignore stop errors from transient native state.
    }
  }, []);

  const abort = useCallback(() => {
    ignoreErrorsUntilRef.current = Date.now() + 1500;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Ignore abort errors from transient native state.
    } finally {
      setIsListening(false);
      lastLevelRef.current = 0;
      setLevel(0);
    }
  }, []);

  return useMemo(
    () => ({
      abort,
      error,
      isAvailable,
      isListening,
      isStarting,
      level,
      start,
      stop,
      supportsLocalRecognition,
    }),
    [abort, error, isAvailable, isListening, isStarting, level, start, stop, supportsLocalRecognition],
  );
}
