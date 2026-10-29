import * as Clipboard from 'expo-clipboard';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';

import { getSelectedModelVariant, getVisibleModels } from '@/providers/opencode-model-selection';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { mergeSharedDraft } from '@/lib/share/parse';
import { workspaceKey } from '@/providers/workspace-types';
import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import { copyHaptic } from '@/lib/haptics';
import { parseShellCommand, replaceComposerTrigger } from '@/lib/opencode/composer';
import { type TranscriptEntry } from '@/lib/opencode/format';
import type { PromptContextItem } from '@/lib/opencode/prompt-inbox';
import { buildTranscriptRows, getTurnPatchDetails } from '@/lib/opencode/transcript';
import { getLatestContextTokens } from '@/lib/opencode/usage';
import type { ComposerSuggestion } from './composer-suggestion-types';
import { useChatComposerNotices } from './use-chat-composer-notices';
import { useChatDraft } from './use-chat-draft';
import { useChatViewActions } from './use-chat-view-actions';
import { useChatViewVoice } from './use-chat-view-voice';
import { useComposerSuggestions } from './use-composer-suggestions';
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
  const { activeSession, currentSessionId, ensureActiveSession } = useCurrentSession();
  const { forkSession, revertSession, sessionStatuses, sessions, unrevertSession } = useSessionLibrary();
  const { availableAgents, availableModels, configuredProviders, modelRouting } = useCapabilities();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { connection, settings, serverCapabilities } = useConnection();
  const connectionScope = getConnectionScope(settings);
  const { approvals } = useApprovals();
  const conversationContext = useConversation();
  const { conversation, clearConversationFeedback, toggleConversationMode } = conversationContext;
  const {
    pendingPrompts, cancelPrompt, abortSession, clearPromptError, commands, currentDiffs, currentDiffScope, currentMessages,
    currentPendingPermissions, currentPendingQuestions, currentTodos, currentTranscript, currentUsage,
    diffTurns, executeCommand, executeShell, isBootstrappingChat, isRefreshingDiffs, isRefreshingMessages,
    latestAssistantTurnUsage, promptError, refreshDiffs, rejectQuestion,
    replyToPermission, replyToQuestion, retryTranscript, selectDiffMessage, selectedDiffMessageId, sendPrompt,
    sendingState, setAutoApprove, setDiffScope, transcriptPaging, transcriptReadError, sharedInput,
    availableSkills, availableReferences, searchProjectFiles,
  } = useChat();

  const workspaceId = workspaceKey({ connectionId: getConnectionUiScope(settings), projectPath: activeProject?.path ?? '' });
  const { draft, attachments, context, setDraft, setAttachments, setContext, inputRef, capture, hasFailedInput, recoverFailedInput, dismissFailedInput } =
    useChatDraft(workspaceId, currentSessionId);
  const {
    cancelingPromptId, clearRevertPrefill, handleCancelPendingPrompt, handleCancelRevert, handleRevertMessage, isCancelingRevert,
  } = useChatComposerNotices({
    cancelPrompt,
    currentSessionId,
    inputRef,
    revertSession,
    setDraft,
    transcript: currentTranscript,
    unrevertSession,
  });
  const submittingRef = useRef(false);
  const [changesVisible, setChangesVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();
  const [copiedMessageId, setCopiedMessageId] = useState<string | undefined>();
  const [sendFeedback, setSendFeedback] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focusRequest, setFocusRequest] = useState(0);
  const lastSentAttachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const isV2 = serverCapabilities.contract === 'v2';
  const shellMode = isV2 && serverCapabilities.shellCommand && draft.startsWith('!');
  const { trigger, groups: suggestions, searching: suggestionsSearching, error: suggestionsError } = useComposerSuggestions({
    draft,
    selection,
    enabled: isV2 && serverCapabilities.contextMentions,
    commands,
    agents: availableAgents,
    skills: availableSkills,
    references: availableReferences,
    searchFiles: searchProjectFiles,
  });
  const suggestionsActive = Boolean(trigger && (suggestions.length > 0 || suggestionsSearching || suggestionsError));

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
  const conversationActive = conversation.active;
  const hasDraftInput = !!draft.trim() || attachments.length > 0;
  const showSendAction = !running || hasDraftInput;
  const visibleModels = useMemo(
    () => getVisibleModels(availableModels, configuredProviders, chatPreferences.enabledModelIds),
    [availableModels, chatPreferences.enabledModelIds, configuredProviders],
  );
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
  const displayTranscript = currentTranscript;
  const transcriptRows = useMemo(
    () => buildTranscriptRows(currentTranscript, chatPreferences.timelineDetail),
    [chatPreferences.timelineDetail, currentTranscript],
  );
  const hasTranscriptMessages = currentMessages.length > 0;
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const selectedModelVariant = getSelectedModelVariant(
    chatPreferences.modelId,
    chatPreferences.modelVariantSelections,
    availableModels,
    selectedSession?.model,
  );
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
  const {
    handleToggleRecording,
    handleVoiceRecovery,
    isSpeechInputAvailable,
    isSpeechInputListening,
    setSpeakingMessageId,
    speakingMessageId,
    voiceFeedback,
    setVoiceFeedback,
    voiceRecoveryAction,
  } = useChatViewVoice({
    t,
    chatPreferences,
    conversation: conversationContext,
    running,
    latestAssistantEntry,
    draft,
    setDraft,
    connectionScope,
    activeProjectPath: activeProject?.path,
    block,
  });
  const {
    handleSpeakEntry,
    handleAttach,
    handleAbort,
    handleConfirmStopConversation,
  } = useChatViewActions({
    t,
    chatPreferences,
    conversationActive,
    currentSessionId,
    speakingMessageId,
    abortSession,
    toggleConversationMode,
    setAttachments,
    setSendFeedback,
    setIsStoppingSession,
    setSpeakingMessageId,
    setVoiceFeedback,
  });
  useUpdateBlocker(Boolean(draft || attachments.length || context.length || isSpeechInputListening || speakingMessageId ||
    copiedMessageId || sendFeedback || voiceFeedback || isStoppingSession || isUpdatingAutoApprove));

  const handleSendPrompt = useCallback(async (promptOverride?: string) => {
    if (submittingRef.current) return;
    const snapshot = capture(promptOverride);
    const nextDraft = promptOverride ?? snapshot.draft;
    const nextAttachments = snapshot.attachments;
    const prompt = nextDraft.trim();
    if (!activeProject || (!prompt && nextAttachments.length === 0) || connection.status !== 'connected') {
      return;
    }
    const shellCommand = isV2 && serverCapabilities.shellCommand && nextAttachments.length === 0 && prompt.startsWith('!')
      ? parseShellCommand(prompt)
      : undefined;
    if (isV2 && serverCapabilities.shellCommand && nextAttachments.length === 0 && prompt.startsWith('!') && !shellCommand) {
      setSendFeedback(t('chat:composer.shellEmpty'));
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

      if (shellCommand) {
        await executeShell(sessionId, shellCommand);
        return;
      }

      const commandMatch = nextAttachments.length === 0 ? prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/) : undefined;
      if (commandMatch && commands.some((command) => command.name === commandMatch[1])) {
        await executeCommand(sessionId, commandMatch[1], commandMatch[2] || '');
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments, snapshot.context);
      if (sent) {
        clearRevertPrefill(sessionId);
      } else {
        if (snapshot.restore(sessionId)) setSendFeedback(t('chat:view.couldNotSendRetry'));
      }
    } catch (error) {
      if (snapshot.restore(sessionId)) setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    } finally { submittingRef.current = false; }
  }, [activeProject, capture, clearRevertPrefill, commands, connection.status, currentSessionId, ensureActiveSession, executeCommand, executeShell, isV2, sendPrompt, serverCapabilities.shellCommand, t]);

  const handleDraftChange = useCallback((value: string) => {
    setSendFeedback(undefined);
    setDraft(value);
    setContext((current) => current.filter((item) => value.includes(item.token)));
    setSelection((current) => {
      // Programmatic fills and pastes do not always emit a selection event on
      // web. Collapse the caret to the end when the text jumped by more than a
      // single keystroke; ordinary typing keeps its native selection.
      if (!value) return { start: 0, end: 0 };
      if (current.end === 0 || current.end > value.length || Math.abs(value.length - current.end) > 1) {
        return { start: value.length, end: value.length };
      }
      return current;
    });
  }, [setContext, setDraft]);

  const handleSuggestionSelect = useCallback((suggestion: ComposerSuggestion) => {
    if (!trigger) return;
    const next = replaceComposerTrigger(draft, trigger, suggestion.insert);
    setDraft(next.text);
    setSelection({ start: next.cursor, end: next.cursor });
    if (suggestion.context) {
      setContext((current) => {
        const item = suggestion.context as PromptContextItem;
        return current.some((entry) => entry.kind === item.kind && entry.token === item.token)
          ? current
          : [...current, item];
      });
    }
    setFocusRequest((current) => current + 1);
  }, [draft, setContext, setDraft, trigger]);

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
  async function handleCopyMessage(entry: TranscriptEntry) {
    const value = [entry.text.trim(), entry.error?.trim()].filter(Boolean).join('\n\n');
    if (!value) {
      return;
    }

    await Clipboard.setStringAsync(value);
    setCopiedMessageId(entry.id);
    copyHaptic();
  }

  return {
    header: {
      activeProject, connection, contextModel, contextTokens, conversation,
      currentUsage, latestAssistantTurnUsage, selectedSession, slim,
    },
    content: {
      workspaceId,
      activeSession, activityRunning: running && !awaitingUserInput, awaitingUserInput, cancelingPromptId, changesVisible, completedTodoCount,
      copiedMessageId, currentDiffs, currentDiffScope,
      currentPendingPermissions, currentPendingQuestions, currentSessionId, currentTodos,
      diffAdditions, diffCount, diffDeletions, diffDetails, diffTurns, transcriptRows,
      expandedDiffId, hasTranscriptMessages, isBootstrappingChat, isCancelingRevert, isRefreshingDiffs, isRefreshingMessages,
      pendingInteractions, pendingPrompts, progressIcon, progressVisible,
      retryTranscript, selectedDiffMessageId, speakingMessageId, transcriptPaging, transcriptReadError,
    },
    composer: {
      attachments, availableAgents, chatPreferences, commands, draft,
      isSpeechInputAvailable, isSpeechInputListening,
      isStoppingSession, isUpdatingAutoApprove, selectedAgentLabel, serverCapabilities,
      selectedVariant: selectedModelVariant,
      autoRoutingEnabled: chatPreferences.autoModel.enabled,
      autoRoutingAvailable: modelRouting.available,
      onAutoRoutingChange: (enabled: boolean) => updateChatPreferences({
        autoModel: { ...chatPreferences.autoModel, enabled },
      }),
      showSendAction, visibleModels,
      isV2, suggestions, suggestionsActive, suggestionsSearching, suggestionsError,
      shellMode, focusRequest,
    },
    overlay: {
      approvals, hasFailedInput, sendErrorMessage,
      sessionMenuVisible, voiceFeedback, voiceRecoveryAction,
    },
    actions: {
      buildSendErrorDetails, clearConversationFeedback, clearPromptError, dismissFailedInput,
      forkSession, handleAbort, handleAttach, handleCancelPendingPrompt, handleCancelRevert,
      handleConfirmStopConversation, handleCopyMessage,
      handleDraftChange, handleRevertMessage, handleSelectionChange: setSelection, handleSendPrompt,
      handleSuggestionSelect, handleSpeakEntry, handleToggleRecording,
      handleVoiceRecovery, recoverFailedInput, refreshDiffs, rejectQuestion, replyToPermission,
      replyToQuestion, selectDiffMessage, setAttachments, setAutoApprove, setChangesVisible,
      setCopiedMessageId, setDiffScope, setDraft, setExpandedDiffId, setIsUpdatingAutoApprove,
      setProgressVisible, setSendFeedback, setSessionMenuVisible, setVoiceFeedback,
      toggleConversationMode, updateChatPreferences,
    },
  };
}
