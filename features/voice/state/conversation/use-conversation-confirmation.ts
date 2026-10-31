import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18n } from '@/shared/i18n/index';
import { classifyConfirmation, compactConfirmationCommand, isLongConfirmationCommand } from '@/shared/platform/voice/confirmation';
import { getSpeechPlayback } from '@/shared/platform/voice/speech-config';
import { speakText, stopSpeaking } from '@/shared/platform/voice/speech-output';
import type { ConversationConfirmationState } from '@/features/voice/model/types';
import { CONFIRMATION_DISMISS_TIMEOUT_MS, CONFIRMATION_ECHO_GUARD_MS, CONFIRMATION_LISTEN_TIMEOUT_MS, CONFIRMATION_PROMPT_SETTLE_MS, CONFIRMATION_RETRY_DELAY_MS, MAX_CONFIRMATION_ATTEMPTS, type ConfirmationOptions, type ConfirmationSource, type PendingConfirmation } from '@/features/voice/state/conversation/confirmation-types';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';
import { useLatest } from '@/features/voice/state/conversation/use-latest';
/**
 * Owns the optional pre-submission confirmation step. It is deliberately a
 * provider hook: the pending command never enters chat state, and only the
 * confirm action calls the existing submission path.
 */
export function useConversationConfirmation({
  chatPreferences,
  connectionStatus,
  conversationPhaseRef,
  conversationSessionId,
  rearmConversation,
  retryCommand,
  setConversationFeedback,
  setConversationFeedbackAction,
  setConversationLatestHeardText,
  setConversationPhase,
  startLocalConfirmation,
  startSystemConfirmation,
  stopLocalConfirmation,
  stopSystemInput,
  submitCommand,
}: ConfirmationOptions) {
  const [pending, setPending] = useState<PendingConfirmation>();
  const [speaking, setSpeaking] = useState(false);
  const pendingRef = useRef<PendingConfirmation | undefined>(undefined);
  const listeningActiveRef = useRef(false);
  const attemptRef = useRef(0);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const echoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionIdRef = useRef(conversationSessionId);
  const connectionStatusRef = useRef(connectionStatus);
  const phaseRef = useLatest(conversationPhaseRef);
  const rearmRef = useLatest(rearmConversation);
  const retryCommandRef = useLatest(retryCommand);
  const startLocalRef = useLatest(startLocalConfirmation);
  const startSystemRef = useLatest(startSystemConfirmation);
  const stopLocalRef = useLatest(stopLocalConfirmation);
  const stopSystemRef = useLatest(stopSystemInput);
  const submitRef = useLatest(submitCommand);
  const localeRef = useLatest(chatPreferences.speechLocale);
  const playback = useMemo(() => getSpeechPlayback({
    localTtsPackId: chatPreferences.localTtsPackId,
    localTtsSpeakerId: chatPreferences.localTtsSpeakerId,
    speechVoiceId: chatPreferences.speechVoiceId,
    ttsEngine: chatPreferences.ttsEngine,
  }), [
    chatPreferences.localTtsPackId,
    chatPreferences.localTtsSpeakerId,
    chatPreferences.speechVoiceId,
    chatPreferences.ttsEngine,
  ]);
  useEffect(() => { sessionIdRef.current = conversationSessionId; }, [conversationSessionId]);
  useEffect(() => { connectionStatusRef.current = connectionStatus; }, [connectionStatus]);
  const clearTimers = useCallback(() => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = undefined;
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = undefined;
    }
    if (echoTimerRef.current) {
      clearTimeout(echoTimerRef.current);
      echoTimerRef.current = undefined;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
  }, []);
  const update = useCallback((patch: Partial<PendingConfirmation>) => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    const next = { ...current, ...patch };
    pendingRef.current = next;
    if (mountedRef.current) {
      setPending(next);
    }
  }, []);
  const isCurrent = useCallback((id: number) => (
    mountedRef.current && pendingRef.current?.id === id
  ), []);
  const stopCapture = useCallback(async () => {
    listeningActiveRef.current = false;
    stopSystemRef.current();
    await stopLocalRef.current().catch(() => undefined);
  }, [stopLocalRef, stopSystemRef]);
  const cancelInternal = useCallback((options: { rearm: boolean }) => {
    const hadPending = Boolean(pendingRef.current);
    clearTimers();
    listeningActiveRef.current = false;
    pendingRef.current = undefined;
    if (mountedRef.current) {
      setPending(undefined);
      setSpeaking(false);
    }
    void stopSpeaking().catch(() => undefined);
    void (async () => {
      await stopCapture();
      if (hadPending && options.rearm && !pendingRef.current) {
        await rearmRef.current().catch(() => undefined);
      }
    })();
  }, [clearTimers, rearmRef, stopCapture]);
  const startDismissTimer = useCallback((id: number) => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = undefined;
      if (!isCurrent(id)) {
        return;
      }
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        i18n.t('chat:confirmation.timeout'),
      );
      cancelInternal({ rearm: true });
    }, CONFIRMATION_DISMISS_TIMEOUT_MS);
  }, [cancelInternal, isCurrent, setConversationFeedback, setConversationFeedbackAction]);
  const expire = useCallback((id: number, message: string) => {
    if (!isCurrent(id)) {
      return;
    }
    clearTimers();
    listeningActiveRef.current = false;
    update({ phase: 'expired', error: message });
    setSpeaking(false);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
    void stopCapture();
    startDismissTimer(id);
  }, [clearTimers, isCurrent, setConversationFeedback, setConversationFeedbackAction, startDismissTimer, stopCapture, update]);
  const startListenTimer = useCallback((id: number) => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current);
    }
    listenTimerRef.current = setTimeout(() => {
      listenTimerRef.current = undefined;
      expire(id, i18n.t('chat:confirmation.timeout'));
    }, CONFIRMATION_LISTEN_TIMEOUT_MS);
  }, [expire]);
  const startListening = useCallback(async (id: number) => {
    const current = pendingRef.current;
    if (!current || current.id !== id || !mountedRef.current) {
      return;
    }
    attemptRef.current += 1;
    update({ phase: 'listening', error: undefined });
    listeningActiveRef.current = true;
    const started = current.source === 'local'
      ? await startLocalRef.current().catch(() => false)
      : await startSystemRef.current().catch(() => false);
    if (!isCurrent(id)) {
      listeningActiveRef.current = false;
      await stopCapture();
      return;
    }
    if (!started) {
      listeningActiveRef.current = false;
      expire(id, i18n.t('chat:confirmation.unavailable'));
      return;
    }
    startListenTimer(id);
  }, [expire, isCurrent, startListenTimer, startLocalRef, startSystemRef, stopCapture, update]);
  const scheduleListening = useCallback((id: number) => {
    if (echoTimerRef.current) {
      clearTimeout(echoTimerRef.current);
    }
    echoTimerRef.current = setTimeout(() => {
      echoTimerRef.current = undefined;
      if (isCurrent(id) && pendingRef.current?.phase === 'prompting') {
        void startListening(id);
      }
    }, CONFIRMATION_ECHO_GUARD_MS);
  }, [isCurrent, startListening]);
  const speakPrompt = useCallback(async (record: PendingConfirmation) => {
    const command = compactConfirmationCommand(record.text);
    // Speak the prompt in the command language, not necessarily the UI language.
    const speechLanguage = chatPreferences.speechLocale?.split('-')[0];
    const speak = speechLanguage ? i18n.getFixedT(speechLanguage) : i18n.t.bind(i18n);
    const prompt = isLongConfirmationCommand(command)
      ? speak('chat:confirmation.longReadback')
      : speak('chat:confirmation.readback', { command });
    if (mountedRef.current) {
      setSpeaking(true);
    }
    const started = await speakText({
      language: localeRef.current,
      onDone: () => {
        if (!isCurrent(record.id)) {
          return;
        }
        setSpeaking(false);
        scheduleListening(record.id);
      },
      onEngineFallback: () => {
        applyConversationFeedback(
          setConversationFeedback,
          setConversationFeedbackAction,
          i18n.t('chat:confirmation.ttsFallback'),
        );
      },
      onError: () => {
        if (!isCurrent(record.id)) {
          return;
        }
        setSpeaking(false);
        scheduleListening(record.id);
      },
      playback,
      rate: chatPreferences.speechRate,
      text: prompt,
    }).catch(() => false);
    if (!started && isCurrent(record.id) && pendingRef.current?.phase === 'prompting') {
      setSpeaking(false);
      scheduleListening(record.id);
    }
  }, [chatPreferences.speechLocale, chatPreferences.speechRate, isCurrent, localeRef, playback, scheduleListening, setConversationFeedback, setConversationFeedbackAction]);
  const begin = useCallback((text: string, source: ConfirmationSource) => {
    const trimmed = text.trim();
    if (!trimmed || !chatPreferences.confirmVoiceCommands) {
      return false;
    }
    if (connectionStatusRef.current !== 'connected') {
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        i18n.t('chat:confirmation.connectionLost'),
      );
      return false;
    }
    clearTimers();
    listeningActiveRef.current = false;
    void stopSpeaking().catch(() => undefined);
    const id = ++idRef.current;
    const record: PendingConfirmation = {
      id,
      text: trimmed,
      source,
      sessionId: sessionIdRef.current,
      phase: 'prompting',
    };
    attemptRef.current = 0;
    pendingRef.current = record;
    if (mountedRef.current) {
      setPending(record);
      setSpeaking(false);
    }
    phaseRef.current.current = 'confirming';
    setConversationPhase('confirming');
    setConversationLatestHeardText(trimmed);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    void (async () => {
      // Let an aborted command recognizer release the audio session before TTS
      // claims it, then read the command back and wait an echo guard.
      await stopCapture();
      await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_PROMPT_SETTLE_MS));
      if (!isCurrent(id)) {
        return;
      }
      await speakPrompt(record);
    })();
    return true;
  }, [chatPreferences.confirmVoiceCommands, clearTimers, isCurrent, phaseRef, setConversationFeedback, setConversationFeedbackAction, setConversationLatestHeardText, setConversationPhase, speakPrompt, stopCapture]);
  const confirm = useCallback((text?: string) => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    if (connectionStatusRef.current !== 'connected'
      || (current.sessionId && current.sessionId !== sessionIdRef.current)) {
      applyConversationFeedback(
        setConversationFeedback,
        setConversationFeedbackAction,
        i18n.t('chat:confirmation.sessionChanged'),
      );
      cancelInternal({ rearm: true });
      return;
    }
    const value = (text ?? current.text).trim();
    if (!value) {
      update({ error: i18n.t('chat:confirmation.emptyEdit') });
      return;
    }
    clearTimers();
    listeningActiveRef.current = false;
    pendingRef.current = undefined;
    if (mountedRef.current) {
      setPending(undefined);
      setSpeaking(false);
    }
    void stopSpeaking().catch(() => undefined);
    void stopCapture();
    submitRef.current(value);
  }, [cancelInternal, clearTimers, setConversationFeedback, setConversationFeedbackAction, stopCapture, submitRef, update]);
  const retry = useCallback(() => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    clearTimers();
    listeningActiveRef.current = false;
    pendingRef.current = undefined;
    if (mountedRef.current) {
      setPending(undefined);
      setSpeaking(false);
    }
    void stopSpeaking().catch(() => undefined);
    void (async () => {
      await stopCapture();
      await retryCommandRef.current().catch(() => false);
    })();
  }, [clearTimers, retryCommandRef, stopCapture]);

  const edit = useCallback(() => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    clearTimers();
    listeningActiveRef.current = false;
    update({ phase: 'editing', error: undefined });
    setSpeaking(false);
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
    void stopSpeaking().catch(() => undefined);
    void stopCapture();
  }, [clearTimers, setConversationFeedback, setConversationFeedbackAction, stopCapture, update]);

  const cancel = useCallback(() => {
    cancelInternal({ rearm: true });
  }, [cancelInternal]);

  const handleResultEnd = useCallback((id: number) => {
    if (!isCurrent(id) || !listeningActiveRef.current) {
      return;
    }
    listeningActiveRef.current = false;
    clearTimers();
    if (attemptRef.current >= MAX_CONFIRMATION_ATTEMPTS) {
      expire(id, i18n.t('chat:confirmation.timeout'));
      return;
    }
    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      i18n.t('chat:confirmation.retryPrompt'),
    );
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      if (isCurrent(id)) {
        void startListening(id);
      }
    }, CONFIRMATION_RETRY_DELAY_MS);
  }, [clearTimers, expire, isCurrent, setConversationFeedback, setConversationFeedbackAction, startListening]);

  const handleResult = useCallback((text: string, isFinal: boolean) => {
    const current = pendingRef.current;
    if (!current || current.phase !== 'listening' || !listeningActiveRef.current) {
      return;
    }
    if (!isFinal) {
      update({ heard: text });
      return;
    }
    const intent = classifyConfirmation(text, chatPreferences.speechLocale);
    if (intent === 'yes') {
      confirm();
      return;
    }
    if (intent === 'retry') {
      retry();
      return;
    }
    if (intent === 'edit') {
      edit();
      return;
    }
    if (intent === 'cancel') {
      cancel();
      return;
    }
    if (intent === 'none') {
      handleResultEnd(current.id);
      return;
    }

    update({ heard: text, error: i18n.t('chat:confirmation.ambiguous') });
    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      i18n.t('chat:confirmation.ambiguous'),
    );
    listeningActiveRef.current = false;
    clearTimers();
    void stopCapture();
    if (attemptRef.current >= MAX_CONFIRMATION_ATTEMPTS) {
      expire(current.id, i18n.t('chat:confirmation.ambiguous'));
      return;
    }
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      if (isCurrent(current.id)) {
        void startListening(current.id);
      }
    }, CONFIRMATION_RETRY_DELAY_MS);
  }, [cancel, chatPreferences.speechLocale, clearTimers, confirm, edit, expire, handleResultEnd, isCurrent, retry, setConversationFeedback, setConversationFeedbackAction, startListening, stopCapture, update]);

  const handleEnd = useCallback(() => {
    const current = pendingRef.current;
    if (!current || current.phase !== 'listening') {
      return;
    }
    handleResultEnd(current.id);
  }, [handleResultEnd]);

  const handleError = useCallback((message: string) => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    expire(current.id, message || i18n.t('chat:confirmation.unavailable'));
  }, [expire]);

  const reset = useCallback(() => {
    cancelInternal({ rearm: false });
  }, [cancelInternal]);

  const confirmation = useMemo<ConversationConfirmationState | undefined>(() => (
    pending
      ? {
        active: true,
        phase: pending.phase,
        text: pending.text,
        heard: pending.heard,
        error: pending.error,
        speaking,
        actions: {
          cancel,
          confirm,
          edit,
          retry,
        },
      }
      : undefined
  ), [cancel, confirm, edit, pending, retry, speaking]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
      listeningActiveRef.current = false;
      pendingRef.current = undefined;
      void stopCapture();
      void stopSpeaking().catch(() => undefined);
    };
  }, [clearTimers, stopCapture]);

  return {
    begin,
    confirmation,
    handleEnd,
    handleError,
    handleResult,
    reset,
  };
}
