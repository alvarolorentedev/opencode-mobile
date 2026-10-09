import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, Platform } from 'react-native';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, getUserTurnForMessage, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { getLatestContextTokens } from '@/lib/opencode/usage';
import { openVoiceSettingsAsync } from '@/lib/voice/permissions';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { useChatViewActions } from './use-chat-view-actions';
import {
  useApprovals,
  useCapabilities,
  useChat,
  useConnection,
  useConversation,
  useCurrentSession,
  usePreferences,
  useProjects,
  useSessionLibrary,
  useUpdates,
} from '@/providers/opencode-contexts';

export function useChatViewController() {
  const { t } = useTranslation();
  const { block } = useUpdates();
  const { activeProject } = useProjects();
  const { activeSession, createSession, currentSessionId, ensureActiveSession, openSession } = useCurrentSession();
  const { forkSession, revertSession, sessionStatuses, sessions, unrevertSession } = useSessionLibrary();
  const { availableAgents, availableModels, configuredProviders } = useCapabilities();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { connection, settings, serverCapabilities } = useConnection();
  const { approvals } = useApprovals();
  const { conversation, clearConversationFeedback, toggleConversationMode } = useConversation();
  const {
    pendingPrompts, abortSession, clearPromptError, commands, currentDiffs, currentDiffScope, currentMessages,
    currentPendingPermissions, currentPendingQuestions, currentTodos, currentTranscript, currentUsage,
    diffTurns, executeCommand, isRefreshingDiffs, isRefreshingMessages,
    latestAssistantTurnUsage, promptError, refreshCurrentSession, refreshDiffs, rejectQuestion,
    replyToPermission, replyToQuestion, selectDiffMessage, selectedDiffMessageId, sendPrompt,
    sendingState, setAutoApprove, setDiffScope, transcriptPaging,
  } = useChat();

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<{ uri: string; mime?: string; filename?: string }[]>([]);
  const [changesVisible, setChangesVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();
  const [copiedMessageId, setCopiedMessageId] = useState<string | undefined>();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>(undefined);
  const [voiceFeedback, setVoiceFeedback] = useState<string | undefined>(undefined);
  const [sendFeedback, setSendFeedback] = useState<string | undefined>(undefined);
  const speechDraftPrefixRef = useRef('');
  const conversationActiveRef = useRef(false);
  const voiceRecoveryContextRef = useRef<'conversation' | 'dictation'>('dictation');
  const draftRef = useRef('');
  const attachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastSentAttachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastAutoSpokenMessageIdRef = useRef<string | undefined>(undefined);

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
  const retryAttempt = status?.type === 'retry' ? status.attempt : undefined;
  const conversationActive = conversation.active;
  const {
    handleSpeakEntry,
    handleAttach,
    handleNewSession,
    handleAbort,
    handleConfirmStopConversation,
  } = useChatViewActions({
    t,
    chatPreferences,
    conversationActive,
    currentSessionId,
    speakingMessageId,
    abortSession,
    createSession,
    openSession,
    toggleConversationMode,
    setAttachments,
    setChangesVisible,
    setSendFeedback,
    setIsCreatingSession,
    setIsStoppingSession,
    setSpeakingMessageId,
    setVoiceFeedback,
  });
  const hasDraftInput = !!draft.trim() || attachments.length > 0;
  const showSendAction = !running || hasDraftInput;
  const visibleModels = useMemo(() => {
    const configuredProviderIds = new Set(configuredProviders.map((provider) => provider.id));
    const enabledModelIds = new Set(chatPreferences.enabledModelIds);

    return availableModels.filter((model) => configuredProviderIds.has(model.providerID) && (enabledModelIds.size === 0 || enabledModelIds.has(model.id)));
  }, [availableModels, chatPreferences.enabledModelIds, configuredProviders]);
  const diffDetails = useMemo(
    () => currentTranscript.flatMap((entry) => entry.details.filter((detail) => detail.kind === 'patch')),
    [currentTranscript],
  );
  const diffCount = currentDiffs.length || (currentDiffScope === 'turn'
    ? new Set(diffDetails.flatMap((detail) => detail.body.split('\n').filter(Boolean))).size
    : 0);
  const diffAdditions = currentDiffs.reduce((sum, diff) => sum + diff.additions, 0);
  const diffDeletions = currentDiffs.reduce((sum, diff) => sum + diff.deletions, 0);
  const selectedAgentLabel = useMemo(
    () => availableAgents.find((agent) => agent.id === chatPreferences.mode)?.label || chatPreferences.mode,
    [availableAgents, chatPreferences.mode],
  );
  const pendingInteractions = currentPendingPermissions.length + currentPendingQuestions.length;
  const awaitingUserInput = pendingInteractions > 0;
  const completedTodoCount = currentTodos.filter((todo) => todo.status === 'completed').length;
  const progressSlice = currentTodos.length ? Math.floor(completedTodoCount / currentTodos.length * 8) : 0;
  const progressIcon = completedTodoCount === currentTodos.length ? 'check-circle' : progressSlice > 0 ? `circle-slice-${progressSlice}` : 'circle-outline';
  const displayTranscript = useMemo(() => currentTranscript.filter(isTranscriptDisplayMessage), [currentTranscript]);
  const currentActivityLabel = useMemo(() => {
    for (let index = currentTranscript.length - 1; index >= 0; index -= 1) {
      const entry = currentTranscript[index];
      if (isTranscriptDisplayMessage(entry)) {
        continue;
      }

      const label = getTranscriptActivityLabel(entry);
      if (label) {
        return label;
      }
    }

    return undefined;
  }, [currentTranscript]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const handleReviewChanges = useCallback((messageId: string) => {
    const turnId = getUserTurnForMessage(currentMessages, messageId);
    if (turnId) {
      setDiffScope('turn');
      selectDiffMessage(turnId);
    }
    Keyboard.dismiss();
    setChangesVisible(true);
  }, [currentMessages, selectDiffMessage, setDiffScope]);

  const contextTokens = useMemo(() => getLatestContextTokens(currentMessages) ?? 0, [currentMessages]);
  const contextModel = useMemo(
    () => availableModels.find((model) => model.providerID === selectedSession?.model?.providerID && model.modelID === selectedSession?.model?.id),
    [availableModels, selectedSession?.model?.id, selectedSession?.model?.providerID],
  );
  // The provider scopes promptError to the active session tree, so a failing
  // subagent is already surfaced here; no local session gate is needed.
  const visiblePromptError = promptError?.message;
  const sendErrorMessage = sendFeedback || visiblePromptError;
  const buildSendErrorDetails = useCallback(() => {
    if (!sendErrorMessage) {
      return '';
    }

    return [
      t('chat:view.sendError.title'),
      t('chat:view.sendError.error', { message: sendErrorMessage }),
      t('chat:view.sendError.time', { time: new Date(promptError?.occurredAt || Date.now()).toISOString() }),
      t('chat:view.sendError.session', { session: currentSessionId || t('chat:view.sendError.unknown') }),
      t('chat:view.sendError.server', { server: settings.serverUrl }),
      t('chat:view.sendError.model', { model: chatPreferences.modelId || t('chat:view.sendError.unknown') }),
      t('chat:view.sendError.attachments', { attachments: lastSentAttachmentsRef.current.map((attachment) => attachment.filename || attachment.mime || t('chat:view.sendError.unnamed')).join(', ') || t('chat:view.sendError.none') }),
    ].join('\n');
  }, [chatPreferences.modelId, currentSessionId, promptError?.occurredAt, sendErrorMessage, settings.serverUrl, t]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const latestAssistantEntry = useMemo(
    () => [...displayTranscript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim()),
    [displayTranscript],
  );
  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onResult: (transcript) => {
      if (conversationActive) {
        return;
      }
      setDraft(`${speechDraftPrefixRef.current}${transcript}`);
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
  useUpdateBlocker(Boolean(draft || attachments.length || isSpeechInputListening || speakingMessageId ||
    copiedMessageId || sendFeedback || voiceFeedback || isCreatingSession || isStoppingSession || isUpdatingAutoApprove));
  // Only offer a recovery action when the snackbar is actually showing a
  // voice-input error, not unrelated conversation or playback feedback.
  // Dictation failures live in this component's own hook; conversation
  // failures carry their action from the provider so the two always match.
  const dictationVoiceFailure = Boolean(voiceFeedback && voiceFeedback === speechInputError);
  const voiceRecoveryAction = dictationVoiceFailure
    ? speechInputErrorAction
    : conversation.feedback
      ? conversation.feedbackAction ?? 'none'
      : 'none';

  const handleSendPrompt = useCallback(async (promptOverride?: string) => {
    const nextDraft = promptOverride ?? draftRef.current;
    const nextAttachments = attachmentsRef.current;
    const prompt = nextDraft.trim();
    if ((!prompt && nextAttachments.length === 0) || connection.status !== 'connected') {
      return;
    }

    try {
      setSendFeedback(undefined);
      lastSentAttachmentsRef.current = nextAttachments;
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      setDraft('');
      setAttachments([]);

      const commandMatch = nextAttachments.length === 0 ? prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/) : undefined;
      if (commandMatch && commands.some((command) => command.name === commandMatch[1])) {
        await executeCommand(sessionId, commandMatch[1], commandMatch[2] || '');
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments);
      if (!sent) {
        setDraft(nextDraft);
        setAttachments(nextAttachments);
        setSendFeedback(t('chat:view.couldNotSendRetry'));
      }
    } catch (error) {
      setDraft(nextDraft);
      setAttachments(nextAttachments);
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    }
  }, [commands, connection.status, currentSessionId, ensureActiveSession, executeCommand, sendPrompt, t]);

  useEffect(() => {
    Keyboard.dismiss();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session changes dismiss local review UI.
    setChangesVisible(false);
  }, [currentSessionId]);

  useEffect(() => {
    if (pendingInteractions > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dismiss review when the server needs input; no render-time equivalent.
      setChangesVisible(false);
    }
  }, [pendingInteractions]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timer = setTimeout(() => setCopiedMessageId(undefined), 1800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);
  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    voiceRecoveryContextRef.current = conversationActiveRef.current ? 'conversation' : 'dictation';

    // While conversation mode is active the provider owns the listening
    // session, including its own retry/fallback and feedback. Surfacing this
    // hook's error too would flash a false failure during the automatic
    // on-device -> network retry.
    if (conversationActiveRef.current) {
      return;
    }

    setVoiceFeedback(speechInputError);
  }, [speechInputError]);
  useEffect(
    () => () => {
      void stopSpeaking().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (running || conversationActive || !chatPreferences.autoPlayAssistantReplies) {
      return;
    }

    if (!latestAssistantEntry || latestAssistantEntry.id === lastAutoSpokenMessageIdRef.current) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const started = await speakText({
        language: chatPreferences.speechLocale,
        onDone: () => {
          if (!cancelled) setSpeakingMessageId((current) => (current === latestAssistantEntry.id ? undefined : current));
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
        rate: chatPreferences.speechRate,
        text: latestAssistantEntry.text,
        voice: chatPreferences.speechVoiceId,
      });

      if (started && !cancelled) {
        lastAutoSpokenMessageIdRef.current = latestAssistantEntry.id;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatPreferences.autoPlayAssistantReplies, chatPreferences.speechLocale, chatPreferences.speechRate, chatPreferences.speechVoiceId, conversationActive, latestAssistantEntry, running, t]);

  async function handleCopyMessage(entry: TranscriptEntry) {
    const value = [entry.text.trim(), entry.error?.trim()].filter(Boolean).join('\n\n');
    if (!value) {
      return;
    }

    await Clipboard.setStringAsync(value);
    setCopiedMessageId(entry.id);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }

  async function handleToggleRecording() {
    if (conversationActive) {
      return;
    }

    if (isSpeechInputListening) {
      stopSpeechInput();
      return;
    }

    speechDraftPrefixRef.current = draft.trim() ? `${draft.trim()} ` : '';
    const release = block();
    let started: boolean;
    try { started = await startSpeechInput(); } finally { release(); }
    if (!started) {
      return;
    }

    void Haptics.selectionAsync().catch(() => undefined);
  }

  // Just-in-time recovery for a voice-input failure: prompt again when the OS
  // still allows it, deep-link to app settings after a denial, or restart the
  // surface the user was in.
  function handleVoiceRecovery() {
    setVoiceFeedback(undefined);
    clearConversationFeedback();

    if (voiceRecoveryAction === 'open-settings') {
      void openVoiceSettingsAsync();
      return;
    }

    if (voiceRecoveryContextRef.current === 'conversation') {
      void toggleConversationMode();
      return;
    }

    void handleToggleRecording();
  }

  return {
    activeProject, activeSession, approvals, attachments, availableAgents, awaitingUserInput,
    buildSendErrorDetails, changesVisible, chatPreferences, clearConversationFeedback,
    clearPromptError, commands, completedTodoCount, connection, contextModel, contextTokens,
    conversation, copiedMessageId, currentActivityLabel, currentDiffs, currentDiffScope,
    currentPendingPermissions, currentPendingQuestions, currentSessionId, currentTodos,
    currentUsage, diffAdditions, diffCount, diffDeletions, diffDetails, diffTurns,
    displayTranscript, draft, expandedDiffId, forkSession, handleAbort, handleAttach,
    handleConfirmStopConversation, handleCopyMessage, handleNewSession, handleReviewChanges,
    handleSendPrompt, handleSpeakEntry, handleToggleRecording, handleVoiceRecovery,
    isCreatingSession, isRefreshingDiffs, isRefreshingMessages, isSpeechInputAvailable,
    isSpeechInputListening, isStoppingSession, isUpdatingAutoApprove, latestAssistantTurnUsage,
    pendingPrompts, pendingInteractions, progressIcon, progressVisible, refreshCurrentSession, refreshDiffs,
    rejectQuestion, replyToPermission, replyToQuestion, revertSession, retryAttempt, running, selectDiffMessage,
    selectedAgentLabel, selectedDiffMessageId, selectedSession, sendErrorMessage,
    serverCapabilities, sessionMenuVisible, setAttachments, setAutoApprove, setChangesVisible,
    setCopiedMessageId, setDiffScope, setDraft, setExpandedDiffId, setIsUpdatingAutoApprove,
    setProgressVisible, setSendFeedback, setSessionMenuVisible, setVoiceFeedback, showSendAction,
    slim, speakingMessageId, toggleConversationMode, transcriptPaging, unrevertSession,
    updateChatPreferences, visibleModels, voiceFeedback, voiceRecoveryAction,
  };
}
