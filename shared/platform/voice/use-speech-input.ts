import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent, type ExpoSpeechRecognitionErrorEvent, type SetCategoryOptions } from 'expo-speech-recognition';

import { ensureVoiceInputPermissionAsync, isVoicePermissionPromptActive } from '@/shared/platform/voice/permissions';
import { canFallbackToNetwork, describeVoiceInputError, type VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { nextStartAttempt, readRecognitionServices, type StartAttempt } from '@/shared/platform/voice/recognition-service';
import { drainRecognition } from '@/shared/platform/voice/recognition-teardown';
import { recognitionErrorReason, recordVoiceDiagnostic, type VoiceCancellation, type VoiceSource } from '@/shared/platform/voice/voice-diagnostics';
import { readVoiceCapabilityFlags } from '@/shared/platform/voice/voice-capability-read';

const RETRY_DELAY_MS = 250;
const START_WATCHDOG_MS = Platform.OS === 'ios' ? 5000 : 3000;
const START_FAILED_MESSAGE = 'Voice input could not start. The device speech recognizer did not respond. Try again.';
const isAppBackgrounded = () => AppState.currentState === 'background';

const IOS_RECOGNITION_CATEGORY: SetCategoryOptions = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
  mode: 'measurement',
};

type StartOptions = { contextualStrings?: string[]; continuous?: boolean };
type StartFailure = { reason: string; code?: ExpoSpeechRecognitionErrorEvent['error']; nativeCode?: number };
const EARLY_END_MS = 1000;
type UseSpeechInputOptions = {
  contextualStrings?: string[];
  levelStep?: number;
  locale?: string;
  onEnd?: () => void;
  onResult: (transcript: string, isFinal: boolean) => void;
  onSpeechStart?: () => void;
  preferOnDevice: boolean;
  source?: Exclude<VoiceSource, 'enrollment'>;
  volumeUpdateIntervalMillis?: number;
};

// `useSpeechInput` is mounted more than once (chat dictation and conversation
// mode) while the native recognizer is a singleton. These module-level values
// route native events and controls to the instance that started recognition,
// including its retries.
let activeOwner: string | undefined;
let activeOnDevice = false;
let recognitionReserved = false;
let nativeSession: { owner: string; request: number; stopping: boolean; ended: Promise<true>; finish: () => void } | undefined;

export function useSpeechInput({
  contextualStrings,
  levelStep = 1,
  locale,
  onEnd,
  onResult,
  onSpeechStart,
  preferOnDevice,
  source = 'dictation',
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
  const ownerId = useId();
  const ignoreErrorsUntilRef = useRef(0);
  const startRequestRef = useRef(0);
  const startPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  const acceptingResultsRef = useRef(false);
  const lastLevelRef = useRef(0);
  const onDeviceFallbackRef = useRef(false);
  const compatibilityModeRef = useRef(false);
  const servicePackageRef = useRef<string | undefined>(undefined);
  const currentAttemptRef = useRef<StartAttempt>({});
  const readyAtRef = useRef<number | undefined>(undefined);
  const heardSpeechRef = useRef(false);
  const attemptRef = useRef(0);
  const attemptedAtRef = useRef(0);
  const recordAttempt = useCallback((outcome: 'retry' | 'blocked' | 'failed', failure: StartFailure) => {
    const attempt = currentAttemptRef.current;
    recordVoiceDiagnostic(outcome, {
      source, phase: 'recognition', reason: failure.reason, statusCode: failure.nativeCode,
      attempt: attemptRef.current, durationMs: Date.now() - attemptedAtRef.current,
      kind: attempt.servicePackage ? 'google' : attempt.compatibility ? 'compatibility' : activeOnDevice ? 'on-device' : 'default',
    });
  }, [source]);
  const startWatchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastStartOptionsRef = useRef<StartOptions>({});
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restrictedRef = useRef(false);
  const canAskAgainRef = useRef(false);
  const beginStartRecoveryRef = useRef<(attempt: StartAttempt, failure: StartFailure) => boolean>(() => false);
  const quantizeLevel = useCallback(
    (value: number) => {
      const safeStep = Math.max(0.25, levelStep);
      return Math.round(Math.max(0, value) / safeStep) * safeStep;
    },
    [levelStep],
  );
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
    readyAtRef.current ??= Date.now();
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
      heardSpeechRef.current = true;
      markStarted();
      onSpeechStart?.();
    }
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current) return;
    markStarted();
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (transcript) heardSpeechRef.current = true;
    if (!transcript && !event.isFinal) return;
    if (event.isFinal) ignoreErrorsUntilRef.current = Date.now() + 1500;
    onResult(transcript, event.isFinal);
  });

  const startRecognition = useCallback(
    async (options: StartOptions = {}, attempt: StartAttempt = {}) => {
      if (nativeSession?.owner === ownerId && !nativeSession.stopping) return true;
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
        if (isAppBackgrounded()) { recordVoiceDiagnostic('cancelled', { source, phase: 'preflight', reason: 'background' }); return false; }
        if (nativeSession?.stopping) {
          const sameOwner = nativeSession.owner === ownerId;
          const drained = await drainRecognition(nativeSession, sameOwner);
          if (isAppBackgrounded()) { recordVoiceDiagnostic('cancelled', { source, phase: 'preflight', reason: 'background' }); return false; }
          if (request !== startRequestRef.current) return false;
          if (!drained && sameOwner) {
            recordVoiceDiagnostic('failed', { source, phase: 'teardown', reason: 'teardown-timeout' });
            setError(START_FAILED_MESSAGE);
            setErrorAction('retry');
            setStartFailed(true);
            return false;
          }
        }
        const capabilities = readVoiceCapabilityFlags();
        setIsAvailable(capabilities.recognitionAvailable);
        setSupportsLocalRecognition(capabilities.onDeviceSupported);
        if (!capabilities.recognitionAvailable) {
          recordVoiceDiagnostic('blocked', { source, phase: 'preflight', reason: 'recognizer-unavailable' });
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

        const permissions = await ensureVoiceInputPermissionAsync();
        if (isAppBackgrounded()) { recordVoiceDiagnostic('cancelled', { source, phase: 'preflight', reason: 'background' }); return false; }
        if (request !== startRequestRef.current) return false;
        if (recognitionReserved && activeOwner !== ownerId) { recordVoiceDiagnostic('blocked', { source, phase: 'preflight', reason: 'recognition-busy' }); setError('Stop the current voice input before starting another recording.'); return false; }
        const nextRestricted = Boolean(permissions.restricted);
        const nextCanAskAgain = Boolean(permissions.canAskAgain);
        restrictedRef.current = nextRestricted;
        canAskAgainRef.current = nextCanAskAgain;

        if (!permissions.granted) {
          recordVoiceDiagnostic('blocked', { source, phase: 'preflight', reason: 'permission-denied' });
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
        readyAtRef.current = undefined;
        heardSpeechRef.current = false;
        attemptedAtRef.current = Date.now();
        attemptRef.current++;
        let resolveEnd!: (value: true) => void;
        // This listener survives hook unmount so cancellation drains before ownership moves.
        const finish = () => {
          if (nativeSession !== session) return;
          nativeSession = undefined;
          subscription.remove();
          const superseded = startRequestRef.current !== session.request;
          const readyAt = readyAtRef.current;
          const endedTooSoon = Platform.OS === 'android' && readyAt !== undefined
            && !heardSpeechRef.current && Date.now() - readyAt < EARLY_END_MS;
          const unexpectedEnd = !session.stopping && !superseded && (readyAt === undefined || endedTooSoon);
          const recoveringEmptyAttempt = !heardSpeechRef.current && (fallbackTimeoutRef.current || (superseded && startPendingRef.current));
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
          resolveEnd(true);
          if (mountedRef.current && unexpectedEnd) {
            beginStartRecoveryRef.current(currentAttemptRef.current, { reason: endedTooSoon ? 'early-end' : 'end-before-ready' });
          } else if (mountedRef.current && !recoveringEmptyAttempt) {
            onEndRef.current?.();
          }
        };
        const subscription = ExpoSpeechRecognitionModule.addListener('end', finish);
        const session = { owner: ownerId, request, stopping: false, finish, ended: new Promise<true>((resolve) => { resolveEnd = resolve; }) };
        nativeSession = session;
        rollbackNativeStart = () => {
          subscription.remove();
          if (nativeSession === session) nativeSession = undefined;
          resolveEnd(true);
        };
        waitingForNativeStart = true;
        startWatchdogRef.current = setTimeout(() => {
          startWatchdogRef.current = undefined;
          if (request !== startRequestRef.current || !mountedRef.current || readyAtRef.current !== undefined) return;
          beginStartRecoveryRef.current(currentAttemptRef.current, { reason: 'ready-timeout' });
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
      } catch {
        clearStartWatchdog();
        if (request !== startRequestRef.current) return false;
        rollbackNativeStart?.();
        if (waitingForNativeStart) return beginStartRecoveryRef.current(currentAttemptRef.current, { reason: 'native-start-rejected' });
        recordVoiceDiagnostic('failed', { source, phase: 'preflight', reason: 'preflight-rejected' });
        setError(START_FAILED_MESSAGE);
        setErrorAction('retry');
        setStartFailed(true);
        return false;
      } finally {
        if (request === startRequestRef.current) {
          startPendingRef.current = false;
          if (!waitingForNativeStart) setIsStarting(false);
          if (activeOwner === ownerId && !nativeSession && !fallbackTimeoutRef.current) recognitionReserved = false;
        }
      }
    },
    [clearError, clearPendingFallback, clearStartWatchdog, contextualStrings, locale, ownerId, preferOnDevice, resetLevel, source, volumeUpdateIntervalMillis],
  );
  const beginStartRecovery = useCallback((attempt: StartAttempt, failure: StartFailure) => {
    clearStartWatchdog();
    const recovery = nextStartAttempt(attempt, {
      platform: Platform.OS,
      ...readRecognitionServices(),
    });
    clearPendingFallback();
    recordAttempt(recovery ? 'retry' : 'failed', failure);
    if (!recovery) {
      acceptingResultsRef.current = false;
      setIsStarting(false);
      setIsListening(false);
      resetLevel();
      setError(START_FAILED_MESSAGE);
      setErrorCode(failure.code);
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
  }, [abortNativeSession, clearError, clearPendingFallback, clearStartWatchdog, ownerId, recordAttempt, resetLevel, startRecognition]);
  useLayoutEffect(() => { beginStartRecoveryRef.current = beginStartRecovery; }, [beginStartRecovery]);

  useSpeechRecognitionEvent('error', (event) => {
    if (activeOwner !== ownerId || !acceptingResultsRef.current || !nativeSession || nativeSession.stopping) return;
    clearStartWatchdog();
    nativeSession.stopping = true;
    if ((event.error === 'aborted' && Platform.OS !== 'android')
      || (event.error === 'client' && Date.now() < ignoreErrorsUntilRef.current)) {
      setIsStarting(false);
      setErrorCode(undefined);
      setIsListening(false);
      resetLevel();
      return;
    }

    const failure = { reason: recognitionErrorReason(event.error), code: event.error, nativeCode: Number.isSafeInteger(event.code) ? event.code : undefined };
    if (canFallbackToNetwork(event.error, activeOnDevice) && !onDeviceFallbackRef.current) {
      recordAttempt('retry', failure);
      onDeviceFallbackRef.current = true;
      activeOnDevice = false;
      setIsStarting(true);
      setIsListening(false);
      resetLevel();
      clearPendingFallback();
      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = undefined;
        void startRecognition(lastStartOptionsRef.current, { ...currentAttemptRef.current, forceNetwork: true });
      }, RETRY_DELAY_MS);
      return;
    }

    const readyAt = readyAtRef.current;
    if (Platform.OS === 'android' && !heardSpeechRef.current
      && (readyAt === undefined || Date.now() - readyAt < EARLY_END_MS)
      && (event.error === 'audio-capture' || event.error === 'client' || event.error === 'aborted')) {
      beginStartRecoveryRef.current(currentAttemptRef.current, failure);
      return;
    }
    if (event.error === 'not-allowed') recordAttempt('blocked', failure);
    else if (event.error === 'client' && source === 'conversation') recordAttempt('retry', failure);
    else if (!['no-speech', 'speech-timeout'].includes(event.error)) recordAttempt('failed', failure);

    const info = describeVoiceInputError(event.error, event.message, {
      canAskAgain: canAskAgainRef.current,
      onDeviceRequested: activeOnDevice,
      restricted: restrictedRef.current,
    });
    setIsStarting(false);
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
    (options?: StartOptions) => {
      attemptRef.current = 0;
      return startRecognition(options);
    },
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
    } catch { /* transient native state */ }
  }, [clearPendingFallback, clearStartWatchdog, ownerId]);
  const abort = useCallback((reason: VoiceCancellation = 'user') => {
    if (activeOwner === ownerId && (acceptingResultsRef.current || fallbackTimeoutRef.current)) {
      recordVoiceDiagnostic('cancelled', { source, phase: 'recognition', reason });
    }
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
    } catch { /* transient native state */ }
  }, [clearPendingFallback, clearStartWatchdog, ownerId, resetLevel, source]);
  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !isVoicePermissionPromptActive()) abort('background');
    });
    return () => {
      subscription.remove();
      mountedRef.current = false;
      abort('screen-exit');
      if (activeOwner === ownerId && !nativeSession) activeOwner = undefined;
    };
  }, [abort, ownerId]);

  return useMemo(() => ({
    abort, error, errorAction, errorCode, isAvailable, isListening, isStarting,
    level, start, startFailed, stop, supportsLocalRecognition,
  }), [
    abort, error, errorAction, errorCode, isAvailable, isListening, isStarting,
    level, start, startFailed, stop, supportsLocalRecognition,
  ]);
}
