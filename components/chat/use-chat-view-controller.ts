import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { mergeSharedDraft } from '@/lib/share/parse';
import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import { type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, getTurnPatchDetails, getUserTurnForMessage, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { getLatestContextTokens } from '@/lib/opencode/usage';
import { openVoiceSettingsAsync } from '@/lib/voice/permissions';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { useChatDraft } from './use-chat-draft';
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
  const connectionScope = getConnectionScope(settings);
  const { approvals } = useApprovals();
  const { conversation, clearConversationFeedback, toggleConversationMode } = useConversation();
  const {
    pendingPrompts, abortSession, clearPromptError, commands, currentDiffs, currentDiffScope, currentMessages,
    currentPendingPermissions, currentPendingQuestions, currentTodos, currentTranscript, currentUsage,
    diffTurns, executeCommand, isRefreshingDiffs, isRefreshingMessages,
    latestAssistantTurnUsage, promptError, refreshCurrentSession, refreshDiffs, rejectQuestion,
    replyToPermission, replyToQuestion, selectDiffMessage, selectedDiffMessageId, sendPrompt,
    sendingState, setAutoApprove, setDiffScope, transcriptPaging, sharedInput,
  } = useChat();

  const { draft, attachments, setDraft, setAttachments, inputRef, capture, hasFailedInput, recoverFailedInput, dismissFailedInput } =
    useChatDraft(`${getConnectionUiScope(settings)}:${activeProject?.path ?? ''}`, currentSessionId);
  const submittingRef = useRef(false);
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
  // Scoped to the turn the overlay shows: an unscoped list would report files
  // from every turn in the transcript.
  const diffDetails = useMemo(
    () => getTurnPatchDetails(currentTranscript, currentMessages, selectedDiffMessageId),
    [currentMessages, currentTranscript, selectedDiffMessageId],
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
  const sendErrorMessage = sendFeedback || visiblePromptError || (hasFailedInput ? t('chat:view.couldNotSendRetry') : undefined);
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

  const pathname = usePathname();
  const sharedPending = sharedInput.pending;
  const consumeShared = sharedInput.consumeShared;
  // Shared content lands in the composer as a reviewable draft; it is never
  // submitted here. Only the chat route consumes it, so the share preview's
  // Discard still clears a staged payload.
  useEffect(() => {
    if (!sharedPending || pathname !== '/' || !currentSessionId || !activeProject?.path) {
      return;
    }
    const payload = consumeShared({ connectionScope, projectPath: activeProject.path, sessionId: currentSessionId });
    if (!payload) return;
    const next = mergeSharedDraft(inputRef.current.draft, inputRef.current.attachments, payload);
    setDraft(next.draft);
    setAttachments(next.attachments);
  }, [activeProject?.path, connectionScope, consumeShared, currentSessionId, pathname, sharedPending, sharedInput.busy, inputRef, setAttachments, setDraft]);

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
    if (submittingRef.current) return;
    const snapshot = capture(promptOverride);
    const nextDraft = promptOverride ?? snapshot.draft;
    const nextAttachments = snapshot.attachments;
    const prompt = nextDraft.trim();
    if ((!prompt && nextAttachments.length === 0) || connection.status !== 'connected') {
      return;
    }

    submittingRef.current = true;
    let sessionId = currentSessionId;
    try {
      setSendFeedback(undefined);
      lastSentAttachmentsRef.current = nextAttachments;
      sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      if (!snapshot.belongsHere(sessionId)) return;
      snapshot.clear(sessionId);

      const commandMatch = nextAttachments.length === 0 ? prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/) : undefined;
      if (commandMatch && commands.some((command) => command.name === commandMatch[1])) {
        await executeCommand(sessionId, commandMatch[1], commandMatch[2] || '');
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments);
      if (!sent) {
        if (snapshot.restore(sessionId)) setSendFeedback(t('chat:view.couldNotSendRetry'));
      }
    } catch (error) {
      if (snapshot.restore(sessionId)) setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    } finally { submittingRef.current = false; }
  }, [capture, commands, connection.status, currentSessionId, ensureActiveSession, executeCommand, sendPrompt, t]);

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
    handleSendPrompt, handleSpeakEntry, handleToggleRecording, handleVoiceRecovery, hasFailedInput, recoverFailedInput, dismissFailedInput,
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
