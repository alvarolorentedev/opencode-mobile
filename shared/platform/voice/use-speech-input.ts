import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent, type ExpoSpeechRecognitionErrorEvent, type SetCategoryOptions } from 'expo-speech-recognition';

import { canFallbackToNetwork, describeVoiceInputError, type VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';

// How long to wait after an on-device failure before retrying with network
// recognition. Short enough to feel automatic, long enough for the native
// recognizer to fully reset after emitting `error` + `end`. It is also shorter
// than the conversation-mode listening restart delay, so the retry claims the
// session before the state machine schedules its own restart.
const NETWORK_FALLBACK_DELAY_MS = 250;
const isAppBackgrounded = () => AppState.currentState === 'background';

// A dictation/observation session on iOS keeps the app in `playAndRecord`.
// Pinning the category and options makes the transition deterministic and keeps
// playback routed to the speaker instead of the receiver.
const IOS_RECOGNITION_CATEGORY: SetCategoryOptions = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
  mode: 'measurement',
};

type StartOptions = { contextualStrings?: string[]; continuous?: boolean };

// `useSpeechInput` is mounted more than once (chat dictation and conversation
// mode) while the native recognizer is a singleton. These module-level values
// route native events and controls to the instance that started recognition,
// including its on-device -> network retry.
let activeOwner: string | undefined;
let activeOnDevice = false;
// Ownership includes the gap before an on-device -> network retry.
let recognitionReserved = false;
let nativeSession: { owner: string; stopping: boolean; ended: Promise<void> } | undefined;

export function useSpeechInput({
  contextualStrings,
  levelStep = 1,
  locale,
  onEnd,
  onResult,
  onSpeechStart,
  preferOnDevice,
  volumeUpdateIntervalMillis = 120,
}: {
  contextualStrings?: string[];
  levelStep?: number;
  locale?: string;
  preferOnDevice: boolean;
  onEnd?: () => void;
  onResult: (transcript: string, isFinal: boolean) => void;
  onSpeechStart?: () => void;
  volumeUpdateIntervalMillis?: number;
}) {
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<ExpoSpeechRecognitionErrorEvent['error']>();
  const [errorAction, setErrorAction] = useState<VoiceRecoveryAction>('none');
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [supportsLocalRecognition, setSupportsLocalRecognition] = useState(() => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition());
  const [isAvailable, setIsAvailable] = useState(() => ExpoSpeechRecognitionModule.isRecognitionAvailable());
  const [level, setLevel] = useState(0);
  // Stable identity for this hook instance, used to coordinate the shared
  // native recognizer across the chat and conversation mounts.
  const ownerId = useId();
  const ignoreErrorsUntilRef = useRef(0);
  const startRequestRef = useRef(0);
  const startPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  const acceptingResultsRef = useRef(false);
  const lastLevelRef = useRef(0);
  // Once the on-device model proves unusable we stop asking for it, so a
  // conversation loop does not fail on every turn.
  const onDeviceFallbackRef = useRef(false);
  const lastStartOptionsRef = useRef<StartOptions>({});
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restrictedRef = useRef(false);
  const canAskAgainRef = useRef(false);

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

  const clearPendingFallback = useCallback(() => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = undefined;
    }
  }, []);

  const readCapabilities = useCallback(() => {
    let available = false;
    let onDevice = false;
    try {
      available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      available = false;
    }
    try {
      onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    } catch {
      onDevice = false;
    }
    return { onDevice, available };
  }, []);

  useSpeechRecognitionEvent('start', () => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    setError(undefined);
    setErrorCode(undefined);
    setErrorAction('none');
    setIsStarting(false);
    setIsListening(true);
    ignoreErrorsUntilRef.current = 0;
  });

  useSpeechRecognitionEvent('speechstart', () => {
    if (activeOwner === ownerId && acceptingResultsRef.current) onSpeechStart?.();
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (!transcript && !event.isFinal) {
      return;
    }

    if (event.isFinal) {
      ignoreErrorsUntilRef.current = Date.now() + 1500;
    }

    onResult(transcript, event.isFinal);
  });

  const startRecognition = useCallback(
    async (options: StartOptions = {}, forceNetwork = false) => {
      clearPendingFallback();
      const request = ++startRequestRef.current;
      setError(undefined);
      setErrorCode(undefined);
      setErrorAction('none');
      setIsStarting(true);
      startPendingRef.current = true;
      ignoreErrorsUntilRef.current = 0;
      let rollbackNativeStart: (() => void) | undefined;

      try {
        if (isAppBackgrounded()) return false;
        if (nativeSession?.owner === ownerId) {
          if (!nativeSession.stopping) return true;
          await nativeSession.ended;
          if (request !== startRequestRef.current) return false;
        }
        const capabilities = readCapabilities();
        setIsAvailable(capabilities.available);
        setSupportsLocalRecognition(capabilities.onDevice);

        if (!capabilities.available) {
          if (activeOwner === ownerId && !nativeSession) recognitionReserved = false;
          const info = describeVoiceInputError('service-not-allowed', undefined, {
            canAskAgain: canAskAgainRef.current,
            onDeviceRequested: false,
            restricted: restrictedRef.current,
          });
          setError(info.message);
          setErrorCode('service-not-allowed');
          setErrorAction(info.action);
          return false;
        }

        const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (request !== startRequestRef.current || isAppBackgrounded()) return false;
        if (recognitionReserved && activeOwner !== ownerId) {
          setError('Stop the current voice input before starting another recording.');
          return false;
        }
        const nextRestricted = Boolean(permissions.restricted);
        const nextCanAskAgain = Boolean(permissions.canAskAgain);
        restrictedRef.current = nextRestricted;
        canAskAgainRef.current = nextCanAskAgain;

        if (!permissions.granted) {
          if (activeOwner === ownerId && !nativeSession) recognitionReserved = false;
          const info = describeVoiceInputError('not-allowed', undefined, {
            canAskAgain: nextCanAskAgain,
            onDeviceRequested: false,
            restricted: nextRestricted,
          });
          setError(info.message);
          setErrorCode('not-allowed');
          setErrorAction(info.action);
          return false;
        }

        const wantsOnDevice = !forceNetwork && !onDeviceFallbackRef.current && preferOnDevice && capabilities.onDevice;
        lastStartOptionsRef.current = {
          contextualStrings: options.contextualStrings,
          continuous: options.continuous,
        };
        const startContextualStrings = options.contextualStrings ?? contextualStrings;

        activeOwner = ownerId;
        recognitionReserved = true;
        activeOnDevice = wantsOnDevice;
        acceptingResultsRef.current = true;
        let resolveEnd!: () => void;
        const session = { owner: ownerId, stopping: false, ended: new Promise<void>((resolve) => { resolveEnd = resolve; }) };
        // This listener survives hook unmount so cancellation drains before ownership moves.
        const subscription = ExpoSpeechRecognitionModule.addListener('end', () => {
          if (nativeSession !== session) return;
          nativeSession = undefined;
          subscription.remove();
          recognitionReserved = startPendingRef.current || Boolean(fallbackTimeoutRef.current);
          acceptingResultsRef.current = false;
          if (mountedRef.current) {
            setIsListening(false);
            setIsStarting(false);
            lastLevelRef.current = 0;
            setLevel(0);
          } else {
            activeOwner = undefined;
          }
          resolveEnd();
          if (mountedRef.current) onEndRef.current?.();
        });
        nativeSession = session;
        rollbackNativeStart = () => {
          subscription.remove();
          if (nativeSession === session) nativeSession = undefined;
          resolveEnd();
        };
        ExpoSpeechRecognitionModule.start({
          addsPunctuation: true,
          continuous: options.continuous ?? Platform.OS !== 'ios',
          contextualStrings: startContextualStrings?.length ? startContextualStrings : undefined,
          interimResults: true,
          iosCategory: IOS_RECOGNITION_CATEGORY,
          iosTaskHint: 'dictation',
          lang: locale || 'en-US',
          requiresOnDeviceRecognition: wantsOnDevice,
          volumeChangeEventOptions: {
            enabled: true,
            intervalMillis: volumeUpdateIntervalMillis,
          },
        });

        return true;
      } catch (startError) {
        if (request !== startRequestRef.current) return false;
        rollbackNativeStart?.();
        if (activeOwner === ownerId && !nativeSession) recognitionReserved = false;
        acceptingResultsRef.current = false;
        setIsListening(false);
        setError(startError instanceof Error ? startError.message : 'Voice input failed to start.');
        setErrorCode(undefined);
        setErrorAction('retry');
        return false;
      } finally {
        if (request === startRequestRef.current) {
          startPendingRef.current = false;
          if (activeOwner === ownerId && !nativeSession && !fallbackTimeoutRef.current) recognitionReserved = false;
          setIsStarting(false);
        }
      }
    },
    [clearPendingFallback, contextualStrings, locale, ownerId, preferOnDevice, readCapabilities, volumeUpdateIntervalMillis],
  );

  useSpeechRecognitionEvent('error', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    setIsStarting(false);
    if (nativeSession?.owner === ownerId) nativeSession.stopping = true;
    if (shouldIgnoreError(event)) {
      setErrorCode(undefined);
      setIsListening(false);
      lastLevelRef.current = 0;
      setLevel(0);
      return;
    }

    // The on-device model may be missing (or Siri/Dictation disabled for it)
    // while the network recognizer still works. Only the instance that started
    // this session retries, once, with network recognition.
    if (canFallbackToNetwork(event.error, activeOnDevice) && !onDeviceFallbackRef.current) {
      onDeviceFallbackRef.current = true;
      activeOnDevice = false;
      setIsListening(false);
      lastLevelRef.current = 0;
      setLevel(0);
      clearPendingFallback();
      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = undefined;
        void startRecognition(lastStartOptionsRef.current, true);
      }, NETWORK_FALLBACK_DELAY_MS);
      return;
    }

    const info = describeVoiceInputError(event.error, event.message, {
      canAskAgain: canAskAgainRef.current,
      onDeviceRequested: activeOnDevice,
      restricted: restrictedRef.current,
    });
    setError(info.message);
    setErrorCode(event.error);
    setErrorAction(info.action);
    setIsListening(false);
    lastLevelRef.current = 0;
    setLevel(0);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current || !isListening) {
      return;
    }

    const nextLevel = quantizeLevel(event.value);
    if (nextLevel === lastLevelRef.current) {
      return;
    }

    lastLevelRef.current = nextLevel;
    setLevel(nextLevel);
  });

  const start = useCallback(
    (options?: StartOptions) => startRecognition(options, false),
    [startRecognition],
  );

  const stop = useCallback(() => {
    startRequestRef.current++;
    startPendingRef.current = false;
    clearPendingFallback();
    setIsStarting(false);
    if (activeOwner !== ownerId) return;
    if (!nativeSession) { recognitionReserved = false; return; }
    if (nativeSession.stopping) return;
    nativeSession.stopping = true;
    ignoreErrorsUntilRef.current = Date.now() + 1500;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Ignore stop errors from transient native state.
    }
  }, [clearPendingFallback, ownerId]);

  const abort = useCallback(() => {
    startRequestRef.current++;
    startPendingRef.current = false;
    acceptingResultsRef.current = false;
    clearPendingFallback();
    setIsStarting(false);
    if (activeOwner !== ownerId) return;
    setIsListening(false);
    lastLevelRef.current = 0;
    setLevel(0);
    if (!nativeSession) { recognitionReserved = false; return; }
    if (nativeSession.stopping) return;
    nativeSession.stopping = true;
    ignoreErrorsUntilRef.current = Date.now() + 1500;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Ignore abort errors from transient native state.
    }
  }, [clearPendingFallback, ownerId]);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') abort();
    });
    return () => {
      subscription.remove();
      mountedRef.current = false;
      abort();
      if (activeOwner === ownerId && !nativeSession) activeOwner = undefined;
    };
  }, [abort, ownerId]);

  return useMemo(
    () => ({
      abort,
      error,
      errorAction,
      errorCode,
      isAvailable,
      isListening,
      isStarting,
      level,
      start,
      stop,
      supportsLocalRecognition,
    }),
    [
      abort,
      error,
      errorAction,
      errorCode,
      isAvailable,
      isListening,
      isStarting,
      level,
      start,
      stop,
      supportsLocalRecognition,
    ],
  );
}
