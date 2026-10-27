import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import { toTranscriptEntry, type SessionMessageRecord } from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { SessionStatus } from '@/lib/opencode/types';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { LOCAL_WAKE_PHRASES, normalizeLocalCommandModel, normalizeLocalWakePhrase } from '@/lib/voice/local-wake-word/types';
import { createWakePhraseSession, normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import { playWakePhraseCue } from '@/lib/voice/wake-feedback';
import { stopWorkingSoundAsync } from '@/lib/voice/working-sound';
import { CONVERSATION_KEEP_AWAKE_TAG,
  type ChatContextValue, type ChatPreferences, type ConnectionState, type ConversationInputPhase, type ConversationReadbackEntry, type ConversationReadbackPhase } from '@/providers/opencode-provider-types';
import { useConversationKeepAwake } from '@/providers/use-conversation-keep-awake';
import { applyConversationFeedback } from '@/providers/conversation/feedback';
import { useConversationArming } from '@/providers/conversation/use-conversation-arming';
import { useConversationListeningEffects } from '@/providers/conversation/use-conversation-listening';
import { useConversationPlayback } from '@/providers/conversation/use-conversation-playback';
import { useConversationReadbackInput } from '@/providers/conversation/use-conversation-readback-input';
import { useConversationSubmit } from '@/providers/conversation/use-conversation-submit';
import { useConversationConnectionFeedback } from '@/providers/conversation/use-conversation-connection';
import { useConversationSnapshot } from '@/providers/conversation/use-conversation-snapshot';
import { useConversationTimers } from '@/providers/conversation/use-conversation-timers';
import { useLocalWakeController } from '@/providers/conversation/use-local-wake-controller';

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
  sendingState: ChatContextValue['sendingState'];
  ensureActiveSession: () => Promise<string | undefined>;
  sendPrompt: ChatContextValue['sendPrompt'];
}) {
  const sendPromptRef = useRef(sendPromptAction);
  useLayoutEffect(() => { sendPromptRef.current = sendPromptAction; }, [sendPromptAction]);
  const sendPrompt = useCallback<ChatContextValue['sendPrompt']>((...args) => sendPromptRef.current(...args), []);
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
      clearConversationResultTimeout();
      if (conversationPhaseRef.current === 'listening') {
        clearCommandTimeout();
      }
    },
    onResult: (transcript, isFinal) => {
      const phase = conversationPhaseRef.current;
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
        if (!hasCommandTimeout()) {
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

  const flushPendingConversationResult = useCallback(() => {
    const transcript = wakePhraseSessionRef.current.command().trim();
    clearPendingConversationResult();
    if (!transcript || conversationPhaseRef.current !== 'listening') {
      return;
    }

    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    abortSpeechInput();
    setConversationTurnSequence((value) => value + 1);
    setPendingConversationTurn(transcript);
    setConversationPhase('submitting');
  }, [abortSpeechInput, clearPendingConversationResult]);
  useLayoutEffect(() => { flushPendingConversationResultRef.current = flushPendingConversationResult; }, [flushPendingConversationResult]);

  const submitLocalCommand = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || conversationPhaseRef.current !== 'listening') {
      return;
    }
    clearPendingConversationResult();
    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    setConversationTurnSequence((value) => value + 1);
    setPendingConversationTurn(trimmed);
    setConversationPhase('submitting');
  }, [clearPendingConversationResult]);

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
    startLocalWakeRef,
    stopLocalWakeRef,
    submitLocalCommand,
  });

  const getConversationAssistantEntries = useCallback(
    (sessionId?: string): ConversationReadbackEntry[] => {
      if (!sessionId) {
        return [];
      }

      return (messagesBySession[sessionId] || []).flatMap((record) => {
        const entry = toTranscriptEntry(record);
        if (entry.role !== 'assistant' || !isTranscriptDisplayMessage(entry) || !entry.text.trim()) {
          return [];
        }
        return [{
          completed: record.info?.time?.completed !== undefined
            || (record.info?.role === 'assistant' && Boolean(record.info.finish)),
          entry,
        }];
      });
    },
    [messagesBySession],
  );

  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => getConversationAssistantEntries(sessionId).at(-1)?.entry,
    [getConversationAssistantEntries],
  );

  const latestAssistantRef = useRef(getLatestConversationAssistantEntry);
  useLayoutEffect(() => { latestAssistantRef.current = getLatestConversationAssistantEntry; }, [getLatestConversationAssistantEntry]);

  const clearConversationFeedback = useCallback(() => {
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
  }, []);

  const stopConversationMode = useCallback(async () => {
    clearPendingConversationResult();
    localWakeModeActiveRef.current = false;
    await stopLocalWakeRef.current().catch(() => undefined);
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    conversationSubmittingRef.current = false;
    conversationPhaseRef.current = 'off';
    setReadbackPhase('idle');
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationLatestHeardText(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
    setConversationWakeSensor('phrase');
  }, [abortSpeechInput, clearPendingConversationResult, setReadbackPhase]);

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
    startLocalWakeRef,
    startSpeechInput,
    voiceWakeMode: chatPreferences.voiceWakeMode,
    wakePhraseSessionRef,
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

  const toggleConversationMode = useCallback(async () => {
    if (conversationStartingRef.current) return;
    if (conversationPhase !== 'off') {
      await stopConversationMode();
      return;
    }

    if (connection.status !== 'connected') {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Connect to OpenCode before starting conversation mode.');
      return;
    }

    if (sendingState.active) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Wait for the current reply to finish before starting conversation mode.');
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Answer the current request before starting conversation mode.');
      return;
    }

    conversationStartingRef.current = true;
    try {
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) return;

      abortSpeechInput();
      await stopSpeaking().catch(() => undefined);
      await stopWorkingSoundAsync().catch(() => undefined);
      setCurrentSessionId(sessionId);
      setConversationSessionId(sessionId);
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
      setPendingConversationTurn(undefined);
      setQueuedConversationPrompt(undefined);
      setReadbackPhase('idle');
      assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(sessionId)?.id;
      const started = await startConversationListening(sessionId);
      if (!started) setConversationSessionId(undefined);
    } finally {
      conversationStartingRef.current = false;
    }
  }, [
    abortSpeechInput,
    connection.status,
    conversationPhase,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    setCurrentSessionId,
    setReadbackPhase,
    startConversationListening,
    stopConversationMode,
  ]);

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
    conversationFeedback,
    conversationFeedbackAction,
    conversationLatestHeardText,
    conversationListeningLevel,
    conversationInputPhase: conversationPhase,
    conversationReadbackPhase,
    conversationSessionId,
    messagesBySession,
    wakePhrase: activeWakePhrase,
  });

  useEffect(() => () => {
    if (conversationListeningRestartTimeoutRef.current) clearTimeout(conversationListeningRestartTimeoutRef.current);
    void stopSpeaking().catch(() => undefined);
  }, []);

  return { conversation, clearConversationFeedback, toggleConversationMode };
}
