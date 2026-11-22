import { useMemo } from 'react';

import { collectDescendantSessionIds, getCurrentPendingRequests } from '@/features/sessions/runtime';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { DiffScope, DiffTurn } from '@/shared/contracts/domain';
import { deriveTodosFromMessages, type SessionMessageRecord } from '@/shared/presentation/format';
import { getTranscript } from '@/shared/presentation/selectors';
import { getDiffTurnMessages, resolveDiffTurn } from '@/shared/presentation/transcript';
import { aggregateUsageSteps, getLatestAssistantTurnUsage, getSessionUsage, type SessionUsageStep } from '@/shared/presentation/usage';
import type { PendingPermissionRequest, PendingQuestionRequest, ServerContract } from '@/shared/protocol/opencode/client';
import type { PendingNotice, PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';
import type { Command, FileDiff, Session, Todo } from '@/shared/protocol/opencode/types';
import { TRANSCRIPT_PAGE_LIMIT } from '@/shared/protocol/services/session-service';

import { isPromptErrorVisible } from '../model/selectors';
import type { ChatContextValue } from '../model/types';

type ChatPresentationInput = Omit<ChatContextValue,
  'pendingPrompts' | 'currentMessages' | 'currentTranscript' | 'currentUsage' | 'latestAssistantTurnUsage' |
  'currentDiffs' | 'currentDiffScope' | 'diffTurns' | 'selectedDiffMessageId' | 'currentTodos' |
  'currentPendingPermissions' | 'currentPendingQuestions' | 'transcriptPaging' | 'commands'
> & {
  currentSessionId?: string;
  activeSession?: Session;
  sessions: Session[];
  commands: Command[];
  executeCommand: ChatContextValue['commands']['execute'];
  executeShell: ChatContextValue['commands']['executeShell'];
  availableModels: ModelOption[];
  serverContract: ServerContract;
  pendingPromptsBySession: Record<string, PendingPrompt[]>;
  pendingNoticesBySession: Record<string, PendingNotice[]>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  diffScopeBySession: Record<string, DiffScope>;
  diffsBySession: Record<string, FileDiff[]>;
  vcsDiffsByScope: Record<'uncommitted' | 'branch', FileDiff[]>;
  selectedDiffMessageBySession: Record<string, string | undefined>;
  todosBySession: Record<string, Todo[]>;
  todoRecordsBySession: Record<string, SessionMessageRecord[]>;
  usageStepsBySession: Record<string, SessionUsageStep[]>;
  messageWindows: Record<string, { nextBefore?: string; hasMore: boolean }>;
  loadingOlderBySession: Record<string, boolean>;
  hydratingSessionIds: Record<string, boolean>;
  loadOlderMessages: ChatContextValue['transcriptPaging']['loadOlder'];
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
};

function pendingNoticeRecord(notice: PendingNotice): SessionMessageRecord {
  return {
    info: {
      id: notice.id,
      sessionID: notice.sessionId,
      time: { created: notice.createdAt },
      role: 'assistant',
      providerID: '',
      modelID: '',
      synthetic: true,
      noticeKind: notice.kind ?? 'server',
    },
    parts: notice.text ? [{ id: `${notice.id}-text-0`, sessionID: notice.sessionId, messageID: notice.id, type: 'text', text: notice.text }] : [],
  };
}

export function useChatPresentation({
  currentSessionId,
  activeSession,
  sessions,
  commands,
  executeCommand,
  executeShell,
  availableModels,
  serverContract,
  pendingPromptsBySession,
  pendingNoticesBySession,
  messagesBySession,
  diffScopeBySession,
  diffsBySession,
  vcsDiffsByScope,
  selectedDiffMessageBySession,
  todosBySession,
  todoRecordsBySession,
  usageStepsBySession,
  messageWindows,
  loadingOlderBySession,
  hydratingSessionIds,
  loadOlderMessages,
  pendingPermissionsBySession,
  pendingQuestionsBySession,
  isRefreshingMessages,
  isRefreshingDiffs,
  isBootstrappingChat,
  transcriptReadError,
  retryTranscript,
  cancelPrompt,
  setDiffScope,
  selectDiffMessage,
  refreshDiffs,
  replyToPermission,
  replyToQuestion,
  rejectQuestion,
  availableSkills,
  availableReferences,
  searchProjectFiles,
  switchSessionModel,
  sendPrompt,
  abortSession,
  setAutoApprove,
  sendingState,
  promptError,
  clearPromptError,
}: ChatPresentationInput) {
  const currentMessages = useMemo(() => {
    if (!currentSessionId) return [];
    const records = messagesBySession[currentSessionId] || [];
    const delivered = new Set(records.map((record) => record.info.id));
    // Inbox notices stay display-only until the session's next turn promotes
    // them to durable synthetic messages.
    const notices = (pendingNoticesBySession?.[currentSessionId] ?? []).filter((notice) => !delivered.has(notice.id));
    return notices.length === 0 ? records : [...records, ...notices.map(pendingNoticeRecord)];
  }, [currentSessionId, messagesBySession, pendingNoticesBySession]);
  const pendingPrompts = useMemo(() => {
    const delivered = new Set(currentMessages.map((record) => record.info.id));
    return (pendingPromptsBySession?.[currentSessionId ?? ''] ?? []).filter((prompt) => !delivered.has(prompt.id));
  }, [currentMessages, currentSessionId, pendingPromptsBySession]);
  const currentDiffScope = useMemo<DiffScope>(
    () => (currentSessionId ? diffScopeBySession[currentSessionId] ?? 'turn' : 'turn'),
    [currentSessionId, diffScopeBySession],
  );
  const currentDiffs = useMemo(
    () => {
      if (!currentSessionId) {
        return [];
      }
      if (currentDiffScope === 'turn') {
        return diffsBySession[currentSessionId] || [];
      }
      return vcsDiffsByScope[currentDiffScope] || [];
    },
    [currentDiffScope, currentSessionId, diffsBySession, vcsDiffsByScope],
  );
  const diffTurns = useMemo<DiffTurn[]>(() => {
    const turns = getDiffTurnMessages(currentMessages);
    return turns.map((record, index) => ({ id: record.info.id, number: index + 1 }));
  }, [currentMessages]);
  const selectedDiffMessageId = useMemo(
    () => (currentSessionId ? resolveDiffTurn(currentMessages, selectedDiffMessageBySession[currentSessionId]) : undefined),
    [currentMessages, currentSessionId, selectedDiffMessageBySession],
  );
  const currentTodos = useMemo(() => {
    if (!currentSessionId) {
      return [];
    }

    const serverTodos = todosBySession[currentSessionId];
    if (serverContract !== 'v2' && serverTodos !== undefined) {
      return serverTodos;
    }

    const todoRecords = todoRecordsBySession[currentSessionId];
    return todoRecords ? deriveTodosFromMessages(todoRecords) : [];
  }, [currentSessionId, serverContract, todoRecordsBySession, todosBySession]);
  const relatedInteractionSessionIds = useMemo(
    () => collectDescendantSessionIds(sessions, [currentSessionId, sendingState.sessionId]),
    [sessions, currentSessionId, sendingState.sessionId],
  );
  const sessionTitleById = useMemo(
    () => Object.fromEntries(sessions.map((session) => [session.id, session.title || undefined])),
    [sessions],
  );
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession, relatedInteractionSessionIds)
      .map((request) => ({ ...request, sourceTitle: sessionTitleById[request.sessionID] })),
    [currentSessionId, pendingPermissionsBySession, relatedInteractionSessionIds, sendingState.sessionId, sessionTitleById],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession, relatedInteractionSessionIds)
      .map((request) => ({ ...request, sourceTitle: sessionTitleById[request.sessionID] })),
    [currentSessionId, pendingQuestionsBySession, relatedInteractionSessionIds, sendingState.sessionId, sessionTitleById],
  );
  const visiblePromptError = useMemo(
    () => (isPromptErrorVisible(promptError, relatedInteractionSessionIds) && promptError
      ? { ...promptError, sourceTitle: promptError.sessionId ? sessionTitleById[promptError.sessionId] : undefined }
      : undefined),
    [promptError, relatedInteractionSessionIds, sessionTitleById],
  );
  const usagePricingByModel = useMemo(
    () => Object.fromEntries(availableModels.flatMap((model) => model.pricing ? [[`${model.providerID}/${model.modelID}`, model.pricing] as const] : [])),
    [availableModels],
  );
  const currentUsage = useMemo(
    () => getSessionUsage(activeSession, aggregateUsageSteps(usageStepsBySession[currentSessionId ?? ''] ?? [], usagePricingByModel),
      !!currentSessionId && !!messageWindows[currentSessionId] && !messageWindows[currentSessionId].hasMore),
    [activeSession, currentSessionId, messageWindows, usageStepsBySession, usagePricingByModel],
  );
  const latestAssistantTurnUsage = useMemo(
    () => getLatestAssistantTurnUsage(currentMessages, usagePricingByModel),
    [currentMessages, usagePricingByModel],
  );
  const currentTranscript = useMemo(() => getTranscript(currentMessages), [currentMessages]);
  // A cached or retained transcript can paint before any read establishes its
  // paging window. Offer scroll-up so the transcript layer can repair the
  // window, but only once the held records look like a full page.
  const hasOlderMessages = currentSessionId
    ? messageWindows[currentSessionId]
      ? messageWindows[currentSessionId].hasMore
      : currentMessages.length >= TRANSCRIPT_PAGE_LIMIT
    : false;
  const isLoadingOlderMessages = currentSessionId ? loadingOlderBySession[currentSessionId] === true : false;
  // Hydration is session-scoped so switching chats quickly cannot let an older
  // read clear the newer session's skeleton.
  const chatRefreshingMessages = currentSessionId
    ? hydratingSessionIds[currentSessionId] === true
    : isBootstrappingChat || isRefreshingMessages;
  const transcriptPaging = useMemo(
    () => ({ loadOlder: loadOlderMessages, hasOlder: hasOlderMessages, isLoadingOlder: isLoadingOlderMessages }),
    [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages],
  );
  return useMemo<ChatContextValue>(
    () => ({
      pendingPrompts, cancelPrompt, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage,
      currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs,
      currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages: chatRefreshingMessages,
      transcriptReadError, retryTranscript, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion,
      rejectQuestion, commands: { available: commands, execute: executeCommand, executeShell }, availableSkills,
      availableReferences, searchProjectFiles, switchSessionModel, sendPrompt, abortSession, setAutoApprove, sendingState,
      promptError: visiblePromptError, clearPromptError, transcriptPaging,
    }),
    [pendingPrompts, cancelPrompt, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage,
      currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs,
      currentTodos, currentPendingPermissions, currentPendingQuestions, chatRefreshingMessages, transcriptReadError,
      retryTranscript, isRefreshingDiffs, isBootstrappingChat, replyToPermission, replyToQuestion, rejectQuestion, commands,
      availableSkills, availableReferences, searchProjectFiles, executeCommand, executeShell, switchSessionModel, sendPrompt,
      abortSession, setAutoApprove, sendingState, visiblePromptError, clearPromptError, transcriptPaging],
  );

}
