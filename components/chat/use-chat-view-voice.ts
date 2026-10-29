import * as Haptics from 'expo-haptics';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TranscriptEntry } from '@/lib/opencode/format';
import { openVoiceSettingsAsync } from '@/lib/voice/permissions';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { getSpeechPlayback } from '@/lib/voice/speech-config';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { createTranscriptAccumulator } from '@/lib/voice/transcript-accumulate';
import type { ChatPreferences, ConversationContextValue } from '@/providers/opencode-provider-types';

type VoiceViewInput = {
  t: TFunction;
  chatPreferences: ChatPreferences;
  conversation: ConversationContextValue;
  running: boolean;
  latestAssistantEntry?: TranscriptEntry;
  draft: string;
  setDraft: (value: string) => void;
  connectionScope: string;
  activeProjectPath?: string;
  block: () => () => void;
};

// Dictation, conversation-mode feedback, and assistant playback are one
// surface: they share a recovery action and must never talk over each other.
export function useChatViewVoice({
  t,
  chatPreferences,
  conversation,
  running,
  latestAssistantEntry,
  draft,
  setDraft,
  connectionScope,
  activeProjectPath,
  block,
}: VoiceViewInput) {
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>(undefined);
  const [voiceFeedback, setVoiceFeedback] = useState<string | undefined>(undefined);
  const speechDraftPrefixRef = useRef('');
  const dictationAccumulatorRef = useRef(createTranscriptAccumulator());
  const conversationActiveRef = useRef(false);
  const voiceRecoveryContextRef = useRef<'conversation' | 'dictation'>('dictation');
  const lastAutoSpokenMessageIdRef = useRef<string | undefined>(undefined);
  const conversationActive = conversation.conversation.active;

  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onEnd: () => dictationAccumulatorRef.current.checkpoint(),
    onResult: (transcript, isFinal) => {
      if (conversationActiveRef.current) return;
      // The recognizer resets its segment on every pause; accumulate so a
      // thinking pause never erases the words already dictated.
      const merged = dictationAccumulatorRef.current.push(transcript, isFinal);
      if (!merged) return;
      setDraft(`${speechDraftPrefixRef.current}${merged}`);
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
  });
  const {
    error: speechInputError,
    errorAction: speechInputErrorAction,
    isAvailable: isSpeechInputAvailable,
    isListening: isSpeechInputListening,
    start: startSpeechInput,
    stop: stopSpeechInput,
  } = speechInput;

  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  useEffect(() => {
    stopSpeechInput();
    void stopSpeaking().catch(() => undefined);
  }, [activeProjectPath, connectionScope, stopSpeechInput]);

  useEffect(() => {
    if (!speechInputError) return;
    voiceRecoveryContextRef.current = conversationActiveRef.current ? 'conversation' : 'dictation';
    // While conversation mode is active the provider owns the listening
    // session, including its own retry/fallback and feedback. Surfacing this
    // hook's error too would flash a false failure during the automatic
    // on-device -> network retry.
    if (conversationActiveRef.current) return;
    setVoiceFeedback(speechInputError);
  }, [speechInputError]);

  useEffect(
    () => () => {
      void stopSpeaking().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (running || conversationActive || !chatPreferences.autoPlayAssistantReplies) return;
    if (!latestAssistantEntry || latestAssistantEntry.id === lastAutoSpokenMessageIdRef.current) return;

    let cancelled = false;
    void (async () => {
      const started = await speakText({
        language: chatPreferences.speechLocale,
        onDone: () => {
          if (!cancelled) setSpeakingMessageId((current) => (current === latestAssistantEntry.id ? undefined : current));
        },
        onEngineFallback: () => {
          if (!cancelled) setVoiceFeedback(t('chat:view.ttsFallback'));
        },
        onError: () => {
          if (!cancelled) {
            setVoiceFeedback(t('chat:view.unableToPlay'));
            setSpeakingMessageId(undefined);
          }
        },
        onStart: () => {
          if (!cancelled) setSpeakingMessageId(latestAssistantEntry.id);
        },
        playback: getSpeechPlayback({
          localTtsPackId: chatPreferences.localTtsPackId,
          localTtsSpeakerId: chatPreferences.localTtsSpeakerId,
          speechVoiceId: chatPreferences.speechVoiceId,
          ttsEngine: chatPreferences.ttsEngine,
        }),
        rate: chatPreferences.speechRate,
        text: latestAssistantEntry.text,
      });

      if (started && !cancelled) lastAutoSpokenMessageIdRef.current = latestAssistantEntry.id;
    })();
    return () => {
      cancelled = true;
    };
  }, [chatPreferences.autoPlayAssistantReplies, chatPreferences.localTtsPackId, chatPreferences.localTtsSpeakerId, chatPreferences.speechLocale, chatPreferences.speechRate, chatPreferences.speechVoiceId, chatPreferences.ttsEngine, conversationActive, latestAssistantEntry, running, t]);

  const handleToggleRecording = useCallback(async () => {
    if (conversationActiveRef.current) return;
    if (isSpeechInputListening) {
      stopSpeechInput();
      return;
    }

    speechDraftPrefixRef.current = draft.trim() ? `${draft.trim()} ` : '';
    dictationAccumulatorRef.current.reset();
    await stopSpeaking().catch(() => undefined);
    const release = block();
    let started: boolean;
    try {
      started = await startSpeechInput();
    } finally {
      release();
    }
    if (!started) return;
    void Haptics.selectionAsync().catch(() => undefined);
  }, [block, draft, isSpeechInputListening, startSpeechInput, stopSpeechInput]);

  // Dictation failures live in this hook; conversation failures carry their
  // action from the provider so the two always match.
  const dictationVoiceFailure = Boolean(voiceFeedback && voiceFeedback === speechInputError);
  const voiceRecoveryAction = dictationVoiceFailure
    ? speechInputErrorAction
    : conversation.conversation.feedback
      ? conversation.conversation.feedbackAction ?? 'none'
      : 'none';

  // Just-in-time recovery for a voice-input failure: prompt again when the OS
  // still allows it, deep-link to app settings after a denial, or restart the
  // surface the user was in.
  const handleVoiceRecovery = useCallback(() => {
    setVoiceFeedback(undefined);
    conversation.clearConversationFeedback();

    if (voiceRecoveryAction === 'open-settings') {
      void openVoiceSettingsAsync();
      return;
    }
    if (voiceRecoveryContextRef.current === 'conversation') {
      void conversation.toggleConversationMode();
      return;
    }
    void handleToggleRecording();
  }, [conversation, handleToggleRecording, voiceRecoveryAction]);

  return {
    handleToggleRecording,
    handleVoiceRecovery,
    isSpeechInputAvailable,
    isSpeechInputListening,
    setSpeakingMessageId,
    setVoiceFeedback,
    speakingMessageId,
    voiceFeedback,
    voiceRecoveryAction,
  };
}
