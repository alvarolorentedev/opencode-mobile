import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent, type ExpoSpeechRecognitionErrorEvent, type SetCategoryOptions } from 'expo-speech-recognition';

import { canFallbackToNetwork, describeVoiceInputError, type VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { nextStartAttempt, readRecognitionServices, type StartAttempt } from '@/shared/platform/voice/recognition-service';
import { readVoiceCapabilityFlags } from '@/shared/platform/voice/voice-capability-read';

// A short delay lets the native recognizer fully reset after `error` + `end`.
// It is also shorter than the conversation listening restart delay, so a retry
// claims the session before the state machine schedules its own restart.
const RETRY_DELAY_MS = 250;
// A recognizer should emit `start` shortly after `startListening`. Otherwise the
// session is unusable even when no error was emitted.
const START_WATCHDOG_MS = Platform.OS === 'ios' ? 5000 : 3000;
const START_FAILED_MESSAGE = 'Voice input could not start. The device speech recognizer did not respond. Try again.';
const isAppBackgrounded = () => AppState.currentState === 'background';

// A dictation/observation session on iOS keeps the app in `playAndRecord`.
// Pinning the category and options keeps playback routed to the speaker.
const IOS_RECOGNITION_CATEGORY: SetCategoryOptions = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
  mode: 'measurement',
};

type StartOptions = { contextualStrings?: string[]; continuous?: boolean };
type StartFailure = { code?: ExpoSpeechRecognitionErrorEvent['error']; message?: string };
type UseSpeechInputOptions = {
  contextualStrings?: string[];
  levelStep?: number;
  locale?: string;
  onEnd?: () => void;
  onResult: (transcript: string, isFinal: boolean) => void;
  onSpeechStart?: () => void;
  preferOnDevice: boolean;
  volumeUpdateIntervalMillis?: number;
};

// `useSpeechInput` is mounted more than once (chat dictation and conversation
// mode) while the native recognizer is a singleton. These module-level values
// route native events and controls to the instance that started recognition,
// including its retries.
let activeOwner: string | undefined;
let activeOnDevice = false;
let recognitionReserved = false;
let nativeSession: { owner: string; request: number; stopping: boolean; ended: Promise<void> } | undefined;

export function useSpeechInput({
  contextualStrings,
  levelStep = 1,
  locale,
  onEnd,
  onResult,
  onSpeechStart,
  preferOnDevice,
  volumeUpdateIntervalMillis = 120,
}: UseSpeechInputOptions) {
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<ExpoSpeechRecognitionErrorEvent['error']>();
  const [errorAction, setErrorAction] = useState<VoiceRecoveryAction>('none');
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
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
  // Once the on-device model proves unusable we stop asking for it.
  const onDeviceFallbackRef = useRef(false);
  const compatibilityModeRef = useRef(false);
  const servicePackageRef = useRef<string | undefined>(undefined);
  const currentAttemptRef = useRef<StartAttempt>({});
  const hasStartedRef = useRef(false);
  const startWatchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastStartOptionsRef = useRef<StartOptions>({});
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restrictedRef = useRef(false);
  const canAskAgainRef = useRef(false);
  const beginStartRecoveryRef = useRef<(attempt: StartAttempt, failure?: StartFailure) => boolean>(() => false);
  const quantizeLevel = useCallback(
    (value: number) => {
      const safeStep = Math.max(0.25, levelStep);
      return Math.round(Math.max(0, value) / safeStep) * safeStep;
    },
    [levelStep],
  );
  const shouldIgnoreError = useCallback((event: ExpoSpeechRecognitionErrorEvent) => {
    if (event.error === 'aborted') return true;
    if (event.error === 'client' && Date.now() < ignoreErrorsUntilRef.current) return true;
    return false;
  }, []);
  const clearStartWatchdog = useCallback(() => {
    if (startWatchdogRef.current) {
      clearTimeout(startWatchdogRef.current);
      startWatchdogRef.current = undefined;
    }
  }, []);
  const clearPendingFallback = useCallback(() => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = undefined;
    }
  }, []);
  const clearError = useCallback(() => {
    setError(undefined);
    setErrorCode(undefined);
    setErrorAction('none');
  }, []);
  const resetLevel = useCallback(() => {
    lastLevelRef.current = 0;
    setLevel(0);
  }, []);
  const abortNativeSession = useCallback(() => {
    if (nativeSession?.owner !== ownerId || nativeSession.stopping) return;
    nativeSession.stopping = true;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* transient native state */ }
  }, [ownerId]);
  const markStarted = useCallback(() => {
    hasStartedRef.current = true;
    clearStartWatchdog();
    setStartFailed(false);
    setIsStarting(false);
    setIsListening(true);
    compatibilityModeRef.current = Boolean(currentAttemptRef.current.compatibility);
    servicePackageRef.current = currentAttemptRef.current.servicePackage;
  }, [clearStartWatchdog]);
  useSpeechRecognitionEvent('start', () => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    markStarted();
    clearError();
    ignoreErrorsUntilRef.current = 0;
  });
  useSpeechRecognitionEvent('speechstart', () => {
    if (activeOwner === ownerId && acceptingResultsRef.current) {
      markStarted();
      onSpeechStart?.();
    }
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    markStarted();
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (!transcript && !event.isFinal) return;
    if (event.isFinal) ignoreErrorsUntilRef.current = Date.now() + 1500;
    onResult(transcript, event.isFinal);
  });

  const startRecognition = useCallback(
    async (options: StartOptions = {}, attempt: StartAttempt = {}) => {
      clearPendingFallback();
      clearStartWatchdog();
      const request = ++startRequestRef.current;
      clearError();
      setStartFailed(false);
      setIsStarting(true);
      startPendingRef.current = true;
      ignoreErrorsUntilRef.current = 0;
      let rollbackNativeStart: (() => void) | undefined;
      let waitingForNativeStart = false;

      try {
        if (isAppBackgrounded()) return false;
        if (nativeSession?.owner === ownerId) {
          if (!nativeSession.stopping) return true;
          await nativeSession.ended;
          if (request !== startRequestRef.current) return false;
        }
        const capabilities = readVoiceCapabilityFlags();
        setIsAvailable(capabilities.recognitionAvailable);
        setSupportsLocalRecognition(capabilities.onDeviceSupported);
        if (!capabilities.recognitionAvailable) {
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

        const effectiveAttempt: StartAttempt = {
          compatibility: attempt.compatibility ?? compatibilityModeRef.current,
          forceNetwork: attempt.forceNetwork ?? false,
          servicePackage: attempt.servicePackage ?? servicePackageRef.current,
        };
        currentAttemptRef.current = effectiveAttempt;
        if (effectiveAttempt.compatibility) onDeviceFallbackRef.current = true;
        const wantsOnDevice = !effectiveAttempt.forceNetwork
          && !effectiveAttempt.compatibility
          && !onDeviceFallbackRef.current
          && preferOnDevice
          && capabilities.onDeviceSupported;
        lastStartOptionsRef.current = {
          contextualStrings: options.contextualStrings,
          continuous: options.continuous,
        };
        const startContextualStrings = options.contextualStrings ?? contextualStrings;

        activeOwner = ownerId;
        recognitionReserved = true;
        activeOnDevice = wantsOnDevice;
        acceptingResultsRef.current = true;
        hasStartedRef.current = false;
        let resolveEnd!: () => void;
        const session = { owner: ownerId, request, stopping: false, ended: new Promise<void>((resolve) => { resolveEnd = resolve; }) };
        // This listener survives hook unmount so cancellation drains before ownership moves.
        const subscription = ExpoSpeechRecognitionModule.addListener('end', () => {
          if (nativeSession !== session) return;
          nativeSession = undefined;
          subscription.remove();
          const superseded = startRequestRef.current !== session.request;
          const failedBeforeStart = !hasStartedRef.current && !session.stopping && !superseded;
          hasStartedRef.current = false;
          clearStartWatchdog();
          recognitionReserved = startPendingRef.current || Boolean(fallbackTimeoutRef.current);
          acceptingResultsRef.current = false;
          if (mountedRef.current) {
            setIsListening(false);
            setIsStarting(Boolean(fallbackTimeoutRef.current) || (startPendingRef.current && superseded));
            resetLevel();
          } else {
            activeOwner = undefined;
          }
          resolveEnd();
          if (mountedRef.current) onEndRef.current?.();
          if (failedBeforeStart && mountedRef.current) {
            beginStartRecoveryRef.current(currentAttemptRef.current);
          }
        });
        nativeSession = session;
        rollbackNativeStart = () => {
          subscription.remove();
          if (nativeSession === session) nativeSession = undefined;
          resolveEnd();
        };
        waitingForNativeStart = true;
        // Arm before native start so a synchronous `start` event cancels it.
        startWatchdogRef.current = setTimeout(() => {
          startWatchdogRef.current = undefined;
          if (request !== startRequestRef.current || !mountedRef.current || hasStartedRef.current) return;
          beginStartRecoveryRef.current(currentAttemptRef.current);
        }, START_WATCHDOG_MS);
        ExpoSpeechRecognitionModule.start({
          addsPunctuation: !effectiveAttempt.compatibility,
          continuous: effectiveAttempt.compatibility ? false : options.continuous ?? Platform.OS !== 'ios',
          contextualStrings: startContextualStrings?.length ? startContextualStrings : undefined,
          interimResults: true,
          iosCategory: IOS_RECOGNITION_CATEGORY,
          iosTaskHint: 'dictation',
          lang: locale || 'en-US',
          requiresOnDeviceRecognition: wantsOnDevice,
          androidRecognitionServicePackage: effectiveAttempt.servicePackage,
          volumeChangeEventOptions: {
            enabled: true,
            intervalMillis: volumeUpdateIntervalMillis,
          },
        });
        return true;
      } catch (startError) {
        clearStartWatchdog();
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
          if (!waitingForNativeStart) setIsStarting(false);
          if (activeOwner === ownerId && !nativeSession && !fallbackTimeoutRef.current) recognitionReserved = false;
        }
      }
    },
    [clearError, clearPendingFallback, clearStartWatchdog, contextualStrings, locale, ownerId, preferOnDevice, resetLevel, volumeUpdateIntervalMillis],
  );
  const beginStartRecovery = useCallback((attempt: StartAttempt, failure?: StartFailure) => {
    clearStartWatchdog();
    const recovery = nextStartAttempt(attempt, {
      platform: Platform.OS,
      ...readRecognitionServices(),
    });
    clearPendingFallback();
    if (!recovery) {
      acceptingResultsRef.current = false;
      setIsStarting(false);
      setIsListening(false);
      resetLevel();
      setError(failure?.message ?? START_FAILED_MESSAGE);
      setErrorCode(failure?.code);
      setErrorAction('retry');
      setStartFailed(true);
      abortNativeSession();
      if (activeOwner === ownerId && !nativeSession) recognitionReserved = false;
      return false;
    }

    startRequestRef.current++;
    startPendingRef.current = false;
    acceptingResultsRef.current = false;
    recognitionReserved = true;
    clearError();
    setStartFailed(false);
    setIsStarting(true);
    setIsListening(false);
    resetLevel();
    fallbackTimeoutRef.current = setTimeout(() => {
      fallbackTimeoutRef.current = undefined;
      void startRecognition(lastStartOptionsRef.current, recovery);
    }, RETRY_DELAY_MS);
    abortNativeSession();
    return true;
  }, [abortNativeSession, clearError, clearPendingFallback, clearStartWatchdog, ownerId, resetLevel, startRecognition]);
  useLayoutEffect(() => { beginStartRecoveryRef.current = beginStartRecovery; }, [beginStartRecovery]);

  useSpeechRecognitionEvent('error', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    clearStartWatchdog();
    setIsStarting(false);
    if (nativeSession?.owner === ownerId) nativeSession.stopping = true;
    if (shouldIgnoreError(event)) {
      setErrorCode(undefined);
      setIsListening(false);
      resetLevel();
      return;
    }

    // The on-device model may be missing while network recognition still works.
    if (canFallbackToNetwork(event.error, activeOnDevice) && !onDeviceFallbackRef.current) {
      onDeviceFallbackRef.current = true;
      activeOnDevice = false;
      setIsListening(false);
      resetLevel();
      clearPendingFallback();
      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = undefined;
        void startRecognition(lastStartOptionsRef.current, { ...currentAttemptRef.current, forceNetwork: true });
      }, RETRY_DELAY_MS);
      return;
    }

    // The continuous audio recorder or an OEM recognizer can fail before speech
    // starts. Try safer Android modes before surfacing the failure.
    if (
      !hasStartedRef.current
      && (event.error === 'audio-capture' || event.error === 'client')
      && beginStartRecoveryRef.current(currentAttemptRef.current, { code: event.error, message: event.message })
    ) {
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
    resetLevel();
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current || !isListening) return;
    const nextLevel = quantizeLevel(event.value);
    if (nextLevel === lastLevelRef.current) return;
    lastLevelRef.current = nextLevel;
    setLevel(nextLevel);
  });
  const start = useCallback(
    (options?: StartOptions) => startRecognition(options, {}),
    [startRecognition],
  );
  const stop = useCallback(() => {
    startRequestRef.current++;
    startPendingRef.current = false;
    clearPendingFallback();
    clearStartWatchdog();
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
  }, [clearPendingFallback, clearStartWatchdog, ownerId]);
  const abort = useCallback(() => {
    startRequestRef.current++;
    startPendingRef.current = false;
    acceptingResultsRef.current = false;
    clearPendingFallback();
    clearStartWatchdog();
    setIsStarting(false);
    if (activeOwner !== ownerId) return;
    setIsListening(false);
    resetLevel();
    if (!nativeSession) { recognitionReserved = false; return; }
    if (nativeSession.stopping) return;
    nativeSession.stopping = true;
    ignoreErrorsUntilRef.current = Date.now() + 1500;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Ignore abort errors from transient native state.
    }
  }, [clearPendingFallback, clearStartWatchdog, ownerId, resetLevel]);
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
      startFailed,
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
      startFailed,
      stop,
      supportsLocalRecognition,
    ],
  );
}
