import type { SendPrompt, SendingState } from '@/shared/contracts/prompt-actions';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import { confirmationContextualStrings } from '@/shared/platform/voice/confirmation';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { stopSpeaking } from '@/shared/platform/voice/speech-output';
import { useSpeechInput } from '@/shared/platform/voice/use-speech-input';
import { LOCAL_WAKE_PHRASES, normalizeLocalCommandModel, normalizeLocalWakePhrase } from '@/shared/platform/voice/local-wake-word/types';
import { createWakePhraseSession, normalizeWakePhrase } from '@/shared/platform/voice/wake-phrase';
import { playWakePhraseCue } from '@/shared/platform/voice/wake-feedback';
import { CONVERSATION_KEEP_AWAKE_TAG, type ConversationInputPhase, type ConversationReadbackPhase } from '@/features/voice/model/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ConnectionState } from '@/shared/contracts/domain';
import { useConversationKeepAwake } from '@/features/voice/state/use-conversation-keep-awake';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';
import { useConversationArming } from '@/features/voice/state/conversation/use-conversation-arming';
import { useConversationAssistantEntries } from '@/features/voice/state/conversation/use-conversation-assistant-entries';
import { useConversationConfirmation } from '@/features/voice/state/conversation/use-conversation-confirmation';
import { useConversationConfirmationActions } from '@/features/voice/state/conversation/use-conversation-confirmation-actions';
import { useConversationListeningEffects } from '@/features/voice/state/conversation/use-conversation-listening';
import { useConversationPlayback } from '@/features/voice/state/conversation/use-conversation-playback';
import { useConversationReadbackInput } from '@/features/voice/state/conversation/use-conversation-readback-input';
import { useConversationSessionControl } from '@/features/voice/state/conversation/use-conversation-session-control';
import { useConversationSubmit } from '@/features/voice/state/conversation/use-conversation-submit';
import { useConversationConnectionFeedback } from '@/features/voice/state/conversation/use-conversation-connection';
import { useConversationSnapshot } from '@/features/voice/state/conversation/use-conversation-snapshot';
import { useConversationTimers, useConversationCleanup } from '@/features/voice/state/conversation/use-conversation-timers';
import { useLocalWakeController } from '@/features/voice/state/conversation/use-local-wake-controller';
type ConfirmationApi = ReturnType<typeof useConversationConfirmation>;
export function useConversationState({ connection, chatPreferences, currentSessionId, setCurrentSessionId,
  sessionStatuses, messagesBySession, pendingPermissionsBySession, pendingQuestionsBySession,
  sendingState, ensureActiveSession, sendPrompt: sendPromptAction,
}: {
  connection: ConnectionState;
  chatPreferences: ChatPreferences;
  currentSessionId?: string;
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  sessionStatuses: Record<string, SessionStatus>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  sendingState: SendingState;
  ensureActiveSession: () => Promise<string | undefined>;
  sendPrompt: SendPrompt;
}) {
  const sendPromptRef = useRef(sendPromptAction);
  useLayoutEffect(() => { sendPromptRef.current = sendPromptAction; }, [sendPromptAction]);
  const sendPrompt = useCallback<SendPrompt>((...args) => sendPromptRef.current(...args), []);
  const [conversationPhase, setConversationPhase] = useState<ConversationInputPhase>('off');
  const [conversationReadbackPhase, setConversationReadbackPhase] = useState<ConversationReadbackPhase>('idle');
  const [conversationTurnSequence, setConversationTurnSequence] = useState(0);
  const [conversationSessionId, setConversationSessionId] = useState<string>();
  const [queuedConversationPrompt, setQueuedConversationPrompt] = useState<string>();
  const [pendingConversationTurn, setPendingConversationTurn] = useState<string>();
  const [conversationFeedback, setConversationFeedback] = useState<string>();
  const [conversationFeedbackAction, setConversationFeedbackAction] = useState<VoiceRecoveryAction>('none');
  const [conversationLatestHeardText, setConversationLatestHeardText] = useState<string>();
  const [conversationWakeSensor, setConversationWakeSensor] = useState<'phrase' | 'local'>('phrase');
  const conversationPhaseRef = useRef<ConversationInputPhase>('off');
  const conversationReadbackPhaseRef = useRef<ConversationReadbackPhase>('idle');
  const setReadbackPhase = useCallback((phase: ConversationReadbackPhase) => {
    conversationReadbackPhaseRef.current = phase;
    setConversationReadbackPhase(phase);
  }, []);
  const assistantReplyBaselineIdRef = useRef<string | undefined>(undefined);
  const conversationListeningRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationCancelRequestedRef = useRef(false);
  const conversationStartingRef = useRef(false);
  const conversationSubmittingRef = useRef(false);
  const conversationWakePhrase = normalizeWakePhrase(chatPreferences.conversationWakePhrase);
  const localWakePhrase = normalizeLocalWakePhrase(chatPreferences.localWakePhrase);
  const localCommandModel = normalizeLocalCommandModel(chatPreferences.localCommandModel);
  const localCommandLanguage = chatPreferences.speechLocale?.split('-')[0];
  const activeWakePhrase = conversationWakeSensor === 'local'
    ? LOCAL_WAKE_PHRASES[localWakePhrase].label
    : conversationWakePhrase;
  const localWakeModeActiveRef = useRef(false);
  const startLocalWakeRef = useRef<() => Promise<boolean>>(async () => false);
  const stopLocalWakeRef = useRef<() => Promise<void>>(async () => undefined);
  const startLocalCommandRef = useRef<(samples?: Float32Array) => Promise<boolean>>(async () => false);
  const stopLocalCommandRef = useRef<() => Promise<void>>(async () => undefined);
  const startLocalConfirmationRef = useRef<() => Promise<boolean>>(async () => false);
  const stopLocalConfirmationRef = useRef<() => Promise<void>>(async () => undefined);
  const confirmationRef = useRef<ConfirmationApi | undefined>(undefined);
  const handleCapturedCommandRef = useRef<(text: string, source: 'system' | 'local') => void>(() => undefined);
  const abortSpeechInputRef = useRef<() => void>(() => undefined);
  // Every arm starts a fresh session. The phrase used for that turn is fixed at
  // arm time, so editing the setting never rewrites an in-flight command.
  const wakePhraseSessionRef = useRef(createWakePhraseSession(conversationWakePhrase));
  const speechContextualStrings = useMemo(() => [conversationWakePhrase], [conversationWakePhrase]);
  const flushPendingConversationResultRef = useRef<() => void>(() => undefined);
  const {
    clearCommandTimeout,
    clearPending: clearPendingConversationResult,
    clearResultTimeout: clearConversationResultTimeout,
    hasCommandTimeout,
    scheduleResult: scheduleConversationResult,
    startCommandTimeout: startConversationCommandTimeout,
  } = useConversationTimers({
    abortSpeechInputRef,
    conversationPhaseRef,
    flushPendingConversationResultRef,
    localWakeModeActiveRef,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    startLocalWakeRef,
    wakePhraseSessionRef,
  });
  const speechInput = useSpeechInput({
    contextualStrings: speechContextualStrings,
    levelStep: 2,
    locale: chatPreferences.speechLocale,
    onEnd: () => {
      if (conversationPhaseRef.current === 'confirming') {
        confirmationRef.current?.handleEnd();
        return;
      }
      if (conversationPhaseRef.current === 'armed') {
        // Keep only the phrase tail across the recognizer restart. A phrase
        // split by a pause remains matchable; ambient noise is discarded.
        wakePhraseSessionRef.current.checkpoint();
        return;
      }
      if (conversationPhaseRef.current !== 'listening') {
        return;
      }
      wakePhraseSessionRef.current.checkpoint();
      if (!wakePhraseSessionRef.current.command()) {
        if (!chatPreferences.wakePhraseRequired) {
          // The listening effect restarts a no-wake system recognizer. The local
          // controller owns its own no-wake re-arm.
          return;
        }
        if (localWakeModeActiveRef.current) {
          clearPendingConversationResult();
          conversationPhaseRef.current = 'armed';
          setConversationPhase('armed');
          setConversationLatestHeardText(undefined);
          void startLocalWakeRef.current();
          return;
        }
        // Keep the matched phrase and let the listening effect restart the
        // recognizer. The command window stays open without asking the user to
        // repeat the phrase, which matters on platforms that end a segment.
        if (!hasCommandTimeout()) {
          startConversationCommandTimeout();
        }
        return;
      }
      scheduleConversationResult();
    },
    onSpeechStart: () => {
      if (conversationPhaseRef.current === 'confirming') {
        return;
      }
      clearConversationResultTimeout();
      if (conversationPhaseRef.current === 'listening') {
        clearCommandTimeout();
      }
    },
    onResult: (transcript, isFinal) => {
      const phase = conversationPhaseRef.current;
      if (phase === 'confirming') {
        confirmationRef.current?.handleResult(transcript, isFinal);
        return;
      }
      if (phase !== 'armed' && phase !== 'listening') {
        return;
      }
      const result = wakePhraseSessionRef.current.push(transcript, isFinal);
      if (!result.matched) {
        return;
      }
      if (conversationPhaseRef.current === 'armed') {
        conversationPhaseRef.current = 'listening';
        setConversationPhase('listening');
        applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
        playWakePhraseCue();
      }
      const command = result.command.trim();
      if (!command) {
        if (chatPreferences.wakePhraseRequired && !hasCommandTimeout()) {
          startConversationCommandTimeout();
        }
        return;
      }
      clearCommandTimeout();
      setConversationLatestHeardText(command);
      // A new interim is unfinished speech, even if an earlier segment was final.
      clearConversationResultTimeout();
      if (isFinal) scheduleConversationResult();
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
    volumeUpdateIntervalMillis: 400,
  });
  const {
    abort: abortSpeechInput,
    error: speechInputError,
    errorAction: speechInputErrorAction,
    errorCode: speechInputErrorCode,
    isListening: isConversationListening,
    isStarting: isConversationListeningStarting,
    level: conversationListeningLevel,
    start: startSpeechInput,
  } = speechInput;
  useLayoutEffect(() => {
    abortSpeechInputRef.current = abortSpeechInput;
  }, [abortSpeechInput]);
  const submitCommand = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || conversationSubmittingRef.current || conversationPhaseRef.current === 'off') {
      return;
    }
    clearPendingConversationResult();
    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    setConversationTurnSequence((value) => value + 1);
    setPendingConversationTurn(trimmed);
    setConversationPhase('submitting');
  }, [clearPendingConversationResult]);
  const flushPendingConversationResult = useCallback(() => {
    const transcript = wakePhraseSessionRef.current.command().trim();
    clearPendingConversationResult();
    if (!transcript || conversationPhaseRef.current !== 'listening') {
      return;
    }
    handleCapturedCommandRef.current(transcript, 'system');
  }, [clearPendingConversationResult]);
  useLayoutEffect(() => { flushPendingConversationResultRef.current = flushPendingConversationResult; }, [flushPendingConversationResult]);
  const submitLocalCommand = useCallback((text: string) => {
    handleCapturedCommandRef.current(text, 'local');
  }, []);
  const startConversationListening = useConversationArming({
    abortSpeechInput,
    clearPendingConversationResult,
    conversationCancelRequestedRef,
    conversationListeningRestartTimeoutRef,
    conversationPhaseRef,
    conversationSessionId,
    conversationSubmittingRef,
    conversationWakePhrase,
    localWakeModeActiveRef,
    onSensorChange: setConversationWakeSensor,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    startLocalCommandRef,
    startLocalWakeRef,
    startSpeechInput,
    voiceWakeMode: chatPreferences.voiceWakeMode,
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
    wakePhraseSessionRef,
  });
  const { rearmConversation, retryCommandCapture } = useConversationConfirmationActions({
    clearPendingConversationResult,
    conversationPhaseRef,
    localWakeModeActiveRef,
    rearmConversationListening: startConversationListening,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    startConversationCommandTimeout,
    startLocalCommandRef,
    startLocalWakeRef,
    startSpeechInput,
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
    wakePhraseSessionRef,
  });
  const confirmation = useConversationConfirmation({
    chatPreferences,
    connectionStatus: connection.status,
    conversationPhaseRef,
    conversationSessionId,
    rearmConversation,
    retryCommand: retryCommandCapture,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    startLocalConfirmation: () => startLocalConfirmationRef.current(),
    startSystemConfirmation: () => startSpeechInput({
      contextualStrings: confirmationContextualStrings(chatPreferences.speechLocale),
      continuous: false,
    }),
    stopLocalConfirmation: () => stopLocalConfirmationRef.current(),
    stopSystemInput: abortSpeechInput,
    submitCommand,
  });
  useLayoutEffect(() => { confirmationRef.current = confirmation; }, [confirmation]);
  const handleCapturedCommand = useCallback((text: string, source: 'system' | 'local') => {
    const trimmed = text.trim();
    if (!trimmed || conversationPhaseRef.current !== 'listening') {
      return;
    }
    if (chatPreferences.confirmVoiceCommands && confirmation.begin(trimmed, source)) {
      return;
    }
    if (chatPreferences.confirmVoiceCommands) {
      // begin() reports its own connection/empty failure; never silently send.
      return;
    }
    submitCommand(trimmed);
  }, [chatPreferences.confirmVoiceCommands, confirmation, submitCommand]);
  useLayoutEffect(() => { handleCapturedCommandRef.current = handleCapturedCommand; }, [handleCapturedCommand]);
  useLocalWakeController({
    commandModel: localCommandModel,
    commandLanguage: localCommandLanguage,
    conversationPhaseRef,
    localSpeakerThreshold: chatPreferences.localSpeakerThreshold,
    localSpeakerVerification: chatPreferences.localSpeakerVerification,
    localWakeModeActiveRef,
    localWakePhrase,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    startLocalCommandRef,
    startLocalConfirmationRef,
    startLocalWakeRef,
    stopLocalCommandRef,
    stopLocalConfirmationRef,
    stopLocalWakeRef,
    submitLocalCommand,
    onLocalConfirmation: (text) => confirmationRef.current?.handleResult(text, true),
    onLocalConfirmationEnd: () => confirmationRef.current?.handleEnd(),
    onLocalConfirmationError: (message) => confirmationRef.current?.handleError(message),
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
  });
  const {
    getConversationAssistantEntries,
    getLatestConversationAssistantEntry,
    latestAssistantRef,
  } = useConversationAssistantEntries(messagesBySession);
  const clearConversationFeedback = useCallback(() => {
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
  }, []);
  const { stopConversationMode, toggleConversationMode } = useConversationSessionControl({
    abortSpeechInput,
    assistantReplyBaselineIdRef,
    cancelConfirmation: confirmation.reset,
    clearPendingConversationResult,
    connectionStatus: connection.status,
    conversationCancelRequestedRef,
    conversationListeningRestartTimeoutRef,
    conversationPhase,
    conversationPhaseRef,
    conversationSessionId,
    conversationStartingRef,
    conversationSubmittingRef,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    localWakeModeActiveRef,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingStateActive: sendingState.active,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationLatestHeardText,
    setConversationPhase,
    setConversationSessionId,
    setConversationWakeSensor,
    setCurrentSessionId,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    setReadbackPhase,
    startConversationListening,
    stopLocalWakeRef,
    stopSpeaking,
  });
  const shouldRestartConversation = useCallback(() => {
    const phase = conversationPhaseRef.current;
    return phase === 'armed' || (phase === 'listening' && !wakePhraseSessionRef.current.command());
  }, []);
  const { canRead, pauseInput, resumeInput } = useConversationReadbackInput({
    abortSpeechInput,
    conversationInputPhaseRef: conversationPhaseRef,
    conversationReadbackPhaseRef,
    conversationSessionId,
    startConversationListening,
    stopLocalWakeRef,
  });

  useEffect(() => {
    conversationPhaseRef.current = conversationPhase;
    if (conversationPhase !== 'submitting') {
      conversationSubmittingRef.current = false;
    }
  }, [conversationPhase]);

  useConversationKeepAwake(conversationPhase, CONVERSATION_KEEP_AWAKE_TAG);

  useConversationListeningEffects({
    conversationPhase,
    isConversationListening,
    isConversationListeningStarting,
    conversationPhaseRef,
    conversationCancelRequestedRef,
    conversationSubmittingRef,
    conversationListeningRestartTimeoutRef,
    localWakeModeRef: localWakeModeActiveRef,
    readbackPhase: conversationReadbackPhase,
    shouldRestartConversation,
    startConversationListening,
    abortSpeechInput,
    speechInputError,
    speechInputErrorAction,
    speechInputErrorCode,
    stopConversationMode,
    setConversationFeedback,
    setConversationFeedbackAction,
  });

  useEffect(() => {
    if (conversationPhase !== 'submitting' || !pendingConversationTurn || !conversationSessionId) {
      return;
    }

    setQueuedConversationPrompt(pendingConversationTurn);
    setPendingConversationTurn(undefined);
  }, [conversationPhase, conversationSessionId, pendingConversationTurn]);

  useConversationSubmit({
    assistantReplyBaselineIdRef,
    conversationCancelRequestedRef,
    conversationInputPhase: conversationPhase,
    conversationSessionId,
    conversationTurnSequence,
    latestAssistantRef,
    queuedConversationPrompt,
    sendPrompt,
    setConversationFeedback,
    setConversationFeedbackAction,
    setConversationPhase,
    setPendingConversationTurn,
    setQueuedConversationPrompt,
    setReadbackPhase,
    startConversationListening,
    stopConversationMode,
  });

  useConversationPlayback({
    active: conversationPhase !== 'off',
    chatPreferences,
    conversationSessionId,
    inputPhase: conversationPhase,
    readbackPhase: conversationReadbackPhase,
    turnSequence: conversationTurnSequence,
    inputBusy: Boolean(conversationLatestHeardText),
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sessionStatuses,
    sendingState,
    getConversationAssistantEntries,
    assistantReplyBaselineIdRef,
    canRead,
    pauseInput,
    resumeInput,
    setReadbackPhase,
    setConversationFeedback,
    setConversationFeedbackAction,
    stopConversationMode,
  });

  useConversationConnectionFeedback({
    connection,
    conversationPhase,
    setConversationFeedback,
    setConversationFeedbackAction,
  });

  const conversation = useConversationSnapshot({
    conversationConfirmation: confirmation.confirmation,
    conversationFeedback,
    conversationFeedbackAction,
    conversationLatestHeardText,
    conversationListeningLevel,
    conversationInputPhase: conversationPhase,
    conversationReadbackPhase,
    conversationSessionId,
    messagesBySession,
    wakePhrase: activeWakePhrase,
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
  });

  useConversationCleanup(conversationListeningRestartTimeoutRef, stopSpeaking);

  return { conversation, clearConversationFeedback, toggleConversationMode };
}
