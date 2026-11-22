import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';
import { speakText, stopSpeaking } from '@/shared/platform/voice/speech-output';
import { getSpeechPlayback } from '@/shared/platform/voice/speech-config';
import { stopWorkingSoundAsync } from '@/shared/platform/voice/working-sound';
import type { ConversationInputPhase, ConversationReadbackEntry, ConversationReadbackPhase } from '@/features/voice/model/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { applyConversationFeedback } from '@/features/voice/state/conversation/feedback';
const EMPTY_QUEUE: string[] = [];

// Reads the settled assistant turn aloud. This is deliberately independent of
// the input phase: after submitting, the microphone re-arms while the assistant
// works, and readback starts later when the final reply is available.
export function useConversationPlayback({
  scopeKey,
  active,
  chatPreferences,
  conversationSessionId,
  inputPhase,
  readbackPhase,
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
  turnSequence,
  inputBusy,
  wakePhraseRequired,
}: {
  scopeKey: string;
  active: boolean;
  chatPreferences: ChatPreferences;
  conversationSessionId?: string;
  inputPhase: ConversationInputPhase;
  readbackPhase: ConversationReadbackPhase;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  sessionStatuses: Record<string, SessionStatus>;
  sendingState: { sessionId?: string; active: boolean };
  getConversationAssistantEntries: (sessionId?: string) => ConversationReadbackEntry[];
  assistantReplyBaselineIdRef: { current: string | undefined };
  canRead: () => boolean;
  pauseInput: () => Promise<void>;
  resumeInput: () => void;
  setReadbackPhase: (phase: ConversationReadbackPhase) => void;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  stopConversationMode: () => Promise<void>;
  turnSequence: number;
  inputBusy: boolean;
  wakePhraseRequired: boolean;
}) {
  const { store } = useAppCore();
  const queue = useAppStore((state) => state.conversation[scopeKey]?.readbackQueue ?? EMPTY_QUEUE);
  const readQueue = useCallback(() => store.getState().conversation[scopeKey]?.readbackQueue ?? EMPTY_QUEUE, [scopeKey, store]);
  const setQueue = useCallback((next: string[]) => store.getState().setConversationValue(scopeKey, 'readbackQueue', next), [scopeKey, store]);
  const startingRef = useRef(false);
  const runIdRef = useRef(0);
  const lastTurnSequenceRef = useRef(turnSequence);
  useEffect(() => () => { runIdRef.current += 1; }, []);
  const sessionStatus = conversationSessionId ? sessionStatuses[conversationSessionId] : undefined;
  // In no-wake mode `listening` is the idle input phase, not an active turn.
  // Do not start reply readback while a command is already being captured.
  const inputReady = inputPhase === 'armed'
    || (!wakePhraseRequired && inputPhase === 'listening' && !inputBusy);
  const playback = useMemo(
    () => getSpeechPlayback({
      localTtsPackId: chatPreferences.localTtsPackId,
      localTtsSpeakerId: chatPreferences.localTtsSpeakerId,
      speechVoiceId: chatPreferences.speechVoiceId,
      ttsEngine: chatPreferences.ttsEngine,
    }),
    [
      chatPreferences.localTtsPackId,
      chatPreferences.localTtsSpeakerId,
      chatPreferences.speechVoiceId,
      chatPreferences.ttsEngine,
    ],
  );
  const isSessionRunning = conversationSessionId
    ? sendingState.sessionId === conversationSessionId || sendingState.active || (!!sessionStatus && sessionStatus.type !== 'idle')
    : false;
  const sessionRunningRef = useRef(isSessionRunning);

  useEffect(() => {
    if (!active || playback.engine !== 'local') {
      return;
    }
    // Start loading the neural voice while the user is still speaking so the
    // first readback does not pay the full model-init cost.
    void import('@/shared/platform/voice/tts/runtime')
      .then(({ prewarmLocalTts }) => prewarmLocalTts(playback.packId))
      .catch(() => undefined);
  }, [active, playback]);

  useEffect(() => {
    sessionRunningRef.current = isSessionRunning;
  }, [isSessionRunning]);

  useEffect(() => {
    if (!active || readbackPhase === 'idle') {
      runIdRef.current += 1;
      startingRef.current = false;
      if (readQueue().length) {
        setQueue(EMPTY_QUEUE);
      }
    }
  }, [active, readQueue, readbackPhase, setQueue]);

  useEffect(() => {
    // A confirmed command increments the turn sequence. Drop queued readback
    // and let the submission path establish the new reply baseline.
    if (turnSequence === lastTurnSequenceRef.current) {
      return;
    }
    lastTurnSequenceRef.current = turnSequence;
    runIdRef.current += 1;
    startingRef.current = false;

    setQueue(EMPTY_QUEUE);
    if (readbackPhase === 'speaking') {
      void stopSpeaking().catch(() => undefined);
    }
    setReadbackPhase('waiting');
  }, [readbackPhase, setQueue, setReadbackPhase, turnSequence]);

  useEffect(() => {
    // Wake detection and TTS share the audio session. Stop the current
    // utterance but retain its queue entry so a command timeout can resume it.
    if (!wakePhraseRequired || inputPhase !== 'listening' || readbackPhase !== 'speaking') {
      return;
    }

    runIdRef.current += 1;
    startingRef.current = false;
    void stopSpeaking().catch(() => undefined);
    setReadbackPhase('waiting');
  }, [inputPhase, readbackPhase, setReadbackPhase, wakePhraseRequired]);

  useEffect(() => {
    if (!active || !conversationSessionId || readbackPhase === 'idle' || !inputReady) {
      return;
    }

    const entries = getConversationAssistantEntries(conversationSessionId);
    const baselineId = assistantReplyBaselineIdRef.current;
    let newEntries: ConversationReadbackEntry[];

    if (!baselineId) {
      newEntries = entries;
    } else {
      const baselineIndex = entries.findIndex((item) => item.entry.id === baselineId);
      if (baselineIndex >= 0) {
        newEntries = entries.slice(baselineIndex + 1);
      } else {
        // The transcript window can move past the baseline while a new reply
        // arrives. On a settled turn, treat the latest entry as the new reply;
        // never replay the whole visible history.
        newEntries = isSessionRunning ? [] : entries.slice(-1);
      }
    }

    if (newEntries.length === 0) {
      return;
    }

    let candidates: ConversationReadbackEntry[];
    if (chatPreferences.readInterimAssistantReplies) {
      if (isSessionRunning) {
        // Read only a completed prefix. An in-progress final bubble must wait
        // until the turn settles.
        candidates = [];
        for (const item of newEntries) {
          if (!item.completed) {
            break;
          }
          candidates.push(item);
        }
      } else {
        candidates = newEntries;
      }
    } else if (isSessionRunning) {
      candidates = [];
    } else {
      candidates = newEntries.slice(-1);
    }

    if (candidates.length === 0) {
      return;
    }

    assistantReplyBaselineIdRef.current = candidates[candidates.length - 1].entry.id;
    const nextQueue = [...readQueue(), ...candidates.map(({ entry }) => entry.text)];
    setQueue(nextQueue);
  }, [
    active,
    assistantReplyBaselineIdRef,
    chatPreferences.readInterimAssistantReplies,
    conversationSessionId,
    getConversationAssistantEntries,
    inputBusy,
    inputPhase,
    inputReady,
    isSessionRunning,
    readQueue,
    readbackPhase,
    setQueue,
    wakePhraseRequired,
  ]);

  useEffect(() => {
    if (!active || readbackPhase !== 'waiting' || !inputReady || queue.length === 0 || startingRef.current) {
      return;
    }

    const pendingInteractions = conversationSessionId
      ? (pendingPermissionsBySession[conversationSessionId] || []).length + (pendingQuestionsBySession[conversationSessionId] || []).length
      : 0;
    if (pendingInteractions > 0) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Conversation mode paused because the assistant needs your input on screen.');
      void stopConversationMode();
      return;
    }

    const item = queue[0];
    if (item === undefined) {
      return;
    }

    const runId = ++runIdRef.current;
    startingRef.current = true;
    let finished = false;

    const finish = (failed = false) => {
      if (finished || runId !== runIdRef.current) {
        return;
      }
      finished = true;
      startingRef.current = false;

      if (failed) {
        setQueue(EMPTY_QUEUE);
        setReadbackPhase('idle');
        resumeInput();
        return;
      }

      const remaining = readQueue().slice(1);
      setQueue(remaining);

      if (remaining.length > 0) {
        // Keep the audio session while the queue drains.
        setReadbackPhase('waiting');
        return;
      }

      if (sessionRunningRef.current) {
        setReadbackPhase('waiting');
      } else {
        setReadbackPhase('idle');
      }
      resumeInput();
    };

    void (async () => {
      setReadbackPhase('speaking');
      await stopWorkingSoundAsync().catch(() => undefined);
      await pauseInput().catch(() => undefined);

      if (runId !== runIdRef.current || !canRead()) {
        startingRef.current = false;
        return;
      }

      try {
        let fallbackNotice = false;
        const started = await speakText({
          language: chatPreferences.speechLocale,
          onDone: finish,
          onEngineFallback: () => {
            fallbackNotice = true;
            applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'On-device voice is unavailable. Using the system voice.');
          },
          onError: () => {
            applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Unable to play this assistant reply.');
            finish(true);
          },
          onStart: () => {
            if (!fallbackNotice) {
              applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
            }
            setReadbackPhase('speaking');
          },
          playback,
          rate: chatPreferences.speechRate,
          text: item,
        });

        if (!started) {
          applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Unable to play this assistant reply.');
          finish(true);
        }
      } catch {
        applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Unable to play this assistant reply.');
        finish(true);
      }
    })();
  }, [
    active,
    canRead,
    chatPreferences.speechLocale,
    chatPreferences.speechRate,
    chatPreferences.speechVoiceId,
    conversationSessionId,
    inputBusy,
    inputPhase,
    inputReady,
    pauseInput,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    playback,
    queue,
    readQueue,
    readbackPhase,
    resumeInput,
    setConversationFeedback,
    setConversationFeedbackAction,
    setQueue,
    setReadbackPhase,
    stopConversationMode,
  ]);
}
