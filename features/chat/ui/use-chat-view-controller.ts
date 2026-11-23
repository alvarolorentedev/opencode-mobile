import * as Clipboard from '@/shared/platform/clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';

import { getEffectiveSessionModel, getInitialMode, getSelectedModelVariant, getVisibleModels, recordRecentModelId } from '@/features/ai/index';
import { mergeSharedDraft } from '@/features/sharing/index';
import { workspaceKey } from '@/shared/contracts/workspace';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { copyHaptic } from '@/shared/platform/haptics';
import { replaceComposerTrigger } from '@/features/chat/model/composer';
import type { TranscriptEntry } from '@/shared/presentation/format';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { Command } from '@/shared/protocol/opencode/types';
import type { PromptContextItem } from '@/shared/protocol/opencode/prompt-inbox';
import { buildTranscriptRows, getTurnPatchDetails, isTranscriptDisplayMessage } from '@/shared/presentation/transcript';
import { getLatestContextTokens } from '@/shared/presentation/usage';
import type { ComposerSuggestion } from '@/features/chat/ui/composer-suggestion-types';
import { getChatActivityState, getCurrentTurnActivityKey } from '@/features/chat/ui/chat-view-utils';
import { useChatComposerNotices } from '@/features/chat/ui/use-chat-composer-notices';
import { useChatDraft } from '@/features/chat/ui/use-chat-draft';
import { useChatViewActions } from '@/features/chat/ui/use-chat-view-actions';
import { useChatViewVoice } from '@/features/chat/ui/use-chat-view-voice';
import { useComposerSubmission } from '@/features/chat/ui/use-composer-submission';
import { useComposerSuggestions } from '@/features/chat/ui/use-composer-suggestions';
import { useApprovals, useAutoApprove, useCurrentSession, useSessionLibrary } from '@/features/sessions/context';
import { resolveSessionChatConfig } from '@/features/sessions/index';
import { useCapabilities } from '@/features/ai/context';
import { useChat, useChatBootstrap } from '@/features/chat/context';
import { useConnection } from '@/features/connections/context';
import { useConversation } from '@/features/voice/context';
import { useWorkspacePreferences } from '@/runtime/workspace';
import { useProjectFileSearch, useProjects } from '@/features/projects/context';
import { useUpdateBlocker, useUpdates } from '@/features/updates/context';

export function useChatViewController() {
  const { t } = useTranslation();
  const { block } = useUpdates();
  const { activeProject } = useProjects();
  const { activeSession, currentSessionId, ensureActiveSession, openSession } = useCurrentSession();
  const { forkSession, revertSession, sessionStatuses, sessions, unrevertSession } = useSessionLibrary();
  const { availableAgents, availableModels, configuredProviders, currentConfig, modelRouting } = useCapabilities();
  const { chatPreferences, updateChatPreferences } = useWorkspacePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { connection, settings, serverCapabilities } = useConnection();
  const connectionScope = getConnectionScope(settings);
  const { approvals } = useApprovals();
  const setAutoApprove = useAutoApprove();
  const isBootstrappingChat = useChatBootstrap();
  const searchProjectFiles = useProjectFileSearch();
  const { view, voiceMessages } = useChat();
  const conversationContext = useConversation(voiceMessages);
  const { conversation, clearConversationFeedback, toggleConversationMode } = conversationContext;
  const {
    pendingPrompts, cancelPrompt, abortSession, clearPromptError, commands: commandActions, currentDiffs, currentDiffScope, currentMessages,
    currentPendingPermissions, currentPendingQuestions, currentTodos, currentTranscript, currentUsage,
    diffTurns, isRefreshingDiffs, isRefreshingMessages,
    latestAssistantTurnUsage, promptError, refreshDiffs, rejectQuestion,
    replyToPermission, replyToQuestion, retryTranscript, selectDiffMessage, selectedDiffMessageId, sendPrompt, switchSessionAgent, switchSessionModel,
    sendingState, setDiffScope, transcriptPaging, transcriptReadError,
    availableSkills, availableReferences,
  } = view;
  const commands = commandActions.available;
  const executeCommand = commandActions.execute;
  const executeShell = commandActions.executeShell;

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
    setAttachments,
    setDraft,
    transcript: currentTranscript,
    unrevertSession,
  });
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
  const isV2 = serverCapabilities.contract === 'v2';
  const { handleSendPrompt, isSubmittingPrompt, lastSentAttachmentsRef, sideQuestion, closeSideQuestion } = useComposerSubmission({
    capture, clearRevertPrefill, commands, connectionStatus: connection.status, currentSessionId,
    ensureActiveSession, executeCommand, executeShell, hasActiveProject: Boolean(activeProject), isV2,
    sendPrompt, setSendFeedback, shellCommandAvailable: serverCapabilities.shellCommand, t,
  });
  const shellMode = isV2 && serverCapabilities.shellCommand && draft.startsWith('!');
  const builtinCommands = useMemo<Command[]>(
    () => isV2
      ? [
          { name: 'compact', description: t('chat:composer.builtinCommands.compact') },
          { name: 'btw', description: t('chat:composer.builtinCommands.btw') },
        ]
      : [],
    [isV2, t],
  );
  const { trigger, groups: suggestions, searching: suggestionsSearching, error: suggestionsError } = useComposerSuggestions({
    draft,
    selection,
    enabled: isV2 && serverCapabilities.contextMentions,
    commands,
    builtinCommands,
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
  // Resolve historical replies against the full catalog, not just enabled
  // models: auto-routed turns keep their model after the user changes defaults.
  const modelLabels = useMemo(
    () => new Map(availableModels.map((model) => [`${model.providerID}/${model.modelID}`, model.label])),
    [availableModels],
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
  // A live status row is only needed when no transcript activity row can carry
  // the progress affordance. Messages-only transcripts never build one, and the
  // first moments of a turn precede the first reasoning/tool detail.
  const pendingActivity = pendingPrompts.some((prompt) => prompt.state === 'sending' || prompt.state === 'waiting');
  const activityState = getChatActivityState({
    awaitingUserInput,
    sendingStateActive: sendingState.active,
    submitting: isSubmittingPrompt,
    pendingActive: pendingActivity,
    status,
  });
  const activityStatusLabel = activityState && !getCurrentTurnActivityKey(transcriptRows)
    ? t(`chat:activity.${activityState}`)
    : undefined;
  // Native timeline markers (model/agent/location switches) are records without
  // display content; they must not hide the starter prompts.
  const hasTranscriptMessages = currentTranscript.some(isTranscriptDisplayMessage);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const sessionConfig = useMemo(
    () => resolveSessionChatConfig(selectedSession, currentMessages),
    [currentMessages, selectedSession],
  );
  const selectedAgent = getInitialMode(availableAgents, currentConfig, (isV2 ? sessionConfig.agent : undefined) ?? chatPreferences.mode);
  const selectedAgentLabel = availableAgents.find((agent) => agent.id === selectedAgent)?.label
    ?? t('chat:composer.chooseAgent');
  const effectiveSessionModel = getEffectiveSessionModel(availableModels, currentConfig, availableAgents, sessionConfig, selectedAgent);
  const selectedModelId = effectiveSessionModel ? `${effectiveSessionModel.providerID}/${effectiveSessionModel.id}` : undefined;
  const selectedModelVariant = getSelectedModelVariant(effectiveSessionModel, availableModels);
  const contextTokens = useMemo(() => getLatestContextTokens(currentMessages) ?? 0, [currentMessages]);
  const contextModel = effectiveSessionModel
    ? availableModels.find((model) => model.providerID === effectiveSessionModel.providerID && model.modelID === effectiveSessionModel.id)
    : undefined;
  const selectedModelFallbackLabel = effectiveSessionModel
    ? `${contextModel?.label ?? effectiveSessionModel.id} · ${contextModel?.providerLabel ?? effectiveSessionModel.providerID}`
    : undefined;

  const setSessionModel = useCallback(async (model: ModelOption, variant?: string) => {
    const sessionId = currentSessionId || await ensureActiveSession();
    if (!sessionId) return;
    setSendFeedback(undefined);
    try {
      await switchSessionModel(sessionId, {
        id: model.modelID,
        providerID: model.providerID,
        ...(variant && variant !== 'default' ? { variant } : {}),
      });
      updateChatPreferences({
        recentModelIds: recordRecentModelId(chatPreferences.recentModelIds, model.id),
        ...(chatPreferences.autoModel.enabled ? { autoModel: { ...chatPreferences.autoModel, enabled: false } } : {}),
      });
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    }
  }, [chatPreferences.autoModel, chatPreferences.recentModelIds, currentSessionId, ensureActiveSession, setSendFeedback, switchSessionModel, t, updateChatPreferences]);
  const handleModelSelect = useCallback((model: ModelOption, variant?: string) => {
    void setSessionModel(model, variant);
  }, [setSessionModel]);
  const setSessionAgent = useCallback(async (agent: string) => {
    if (!isV2) {
      updateChatPreferences({ mode: agent });
      return;
    }
    const sessionId = currentSessionId || await ensureActiveSession();
    if (!sessionId) return;
    setSendFeedback(undefined);
    try {
      await switchSessionAgent(sessionId, agent);
      updateChatPreferences({ mode: agent });
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    }
  }, [currentSessionId, ensureActiveSession, isV2, setSendFeedback, switchSessionAgent, t, updateChatPreferences]);
  const handleAgentSelect = useCallback((agent: string) => {
    void setSessionAgent(agent);
  }, [setSessionAgent]);
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
      t('chat:view.sendError.model', { model: selectedModelId || t('chat:view.sendError.unknown') }),
      t('chat:view.sendError.attachments', { attachments: lastSentAttachmentsRef.current.map((attachment) => attachment.filename || attachment.mime || t('chat:view.sendError.unnamed')).join(', ') || t('chat:view.sendError.none') }),
    ].join('\n');
  }, [currentSessionId, lastSentAttachmentsRef, promptError?.occurredAt, selectedModelId, sendErrorMessage, settings.serverUrl, t]);

  const applySharedDraft = useCallback((payload: Parameters<typeof mergeSharedDraft>[2]) => {
    const next = mergeSharedDraft(inputRef.current.draft, inputRef.current.attachments, payload);
    setDraft(next.draft);
    setAttachments(next.attachments);
  }, [inputRef, setAttachments, setDraft]);

  const latestAssistantEntry = useMemo(
    () => [...displayTranscript].reverse().find((entry) => entry.role === 'assistant' && !entry.notice && entry.text.trim()),
    [displayTranscript],
  );
  const {
    handleToggleRecording,
    handleVoiceRecovery,
    isSpeechInputAvailable,
    isSpeechInputListening,
    isSpeechInputStarting,
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
    confirmation,
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
    closeSideQuestion();
  }, [closeSideQuestion, currentSessionId]);

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

  const handleOpenSubagent = useCallback((sessionId: string) => {
    if (sessionId === currentSessionId) return;
    void openSession(sessionId).catch(() => setSendFeedback(t('chat:view.couldNotOpenSubagent')));
  }, [currentSessionId, openSession, t]);

  return {
    sharedDraft: { connectionScope, projectPath: activeProject?.path, sessionId: currentSessionId, apply: applySharedDraft },
    header: {
      activeProject, connection, contextModel, contextTokens, conversation,
      currentUsage, latestAssistantTurnUsage, selectedSession, slim,
    },
    content: {
      workspaceId,
      activeSession, activityRunning: (running || isSubmittingPrompt) && !awaitingUserInput, activityStatusLabel, awaitingUserInput, cancelingPromptId, changesVisible, completedTodoCount,
      copiedMessageId, currentDiffs, currentDiffScope,
      currentPendingPermissions, currentPendingQuestions, currentSessionId, currentTodos,
      diffAdditions, diffCount, diffDeletions, diffDetails, diffTurns, transcriptRows,
      expandedDiffId, hasTranscriptMessages, isBootstrappingChat, isCancelingRevert, isRefreshingDiffs, isRefreshingMessages,
      modelLabels, openSubagent: handleOpenSubagent, pendingInteractions, pendingPrompts, progressIcon, progressVisible,
      retryTranscript, selectedDiffMessageId, speakingMessageId, transcriptPaging, transcriptReadError,
    },
    composer: {
      attachments, availableAgents, chatPreferences, commands, draft,
      isSpeechInputAvailable, isSpeechInputListening, isSpeechInputStarting,
      isStoppingSession, isUpdatingAutoApprove, selectedAgent, selectedAgentLabel, serverCapabilities,
      agentsLoading: currentConfig === undefined,
      selectedVariant: selectedModelVariant,
      selectedModelId,
      selectedModelFallbackLabel,
      autoRoutingEnabled: chatPreferences.autoModel.enabled,
      autoRoutingAvailable: modelRouting.available,
      onAutoRoutingChange: (enabled: boolean) => updateChatPreferences({
        autoModel: { ...chatPreferences.autoModel, enabled },
      }),
      showSendAction, visibleModels,
      isV2, suggestions, suggestionsActive, suggestionsSearching, suggestionsError,
      shellMode, focusRequest,
      onAgentSelect: handleAgentSelect,
      onModelSelect: handleModelSelect,
    },
    overlay: {
      approvals, hasFailedInput, sendErrorMessage,
      sessionMenuVisible, sideQuestion, voiceFeedback, voiceRecoveryAction,
    },
    actions: {
      buildSendErrorDetails, clearConversationFeedback, clearPromptError, dismissFailedInput,
      closeSideQuestion,
      forkSession, handleAbort, handleAttach, handleCancelPendingPrompt, handleCancelRevert,
      confirmation, handleConfirmStopConversation, handleCopyMessage,
      handleDraftChange, handleRevertMessage, handleSelectionChange: setSelection, handleSendPrompt,
      handleSuggestionSelect, handleSpeakEntry, handleToggleRecording, handleModelSelect,
      handleVoiceRecovery, recoverFailedInput, refreshDiffs, rejectQuestion, replyToPermission,
      replyToQuestion, selectDiffMessage, setAttachments, setAutoApprove, setChangesVisible,
      setCopiedMessageId, setDiffScope, setDraft, setExpandedDiffId, setIsUpdatingAutoApprove,
      setProgressVisible, setSendFeedback, setSessionMenuVisible, setVoiceFeedback,
      toggleConversationMode, updateChatPreferences,
    },
  };
}
