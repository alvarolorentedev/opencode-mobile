import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useCapabilitiesCatalog } from '@/features/ai/runtime';
import { useApprovalsCatalog, useSessionCatalog } from '@/features/sessions/runtime';
import { useAppStore, useProjectScope } from '@/runtime/core';
import type { SendingState } from '@/shared/contracts/prompt-actions';
import { commandsOptions } from '@/shared/server-data/catalogs';

import type { ChatCommands } from '../model/types';
import { liveTranscriptPartition } from '../services/queries';
import { useChatPresentation } from './use-chat-presentation';
import { useDiffCatalog } from './use-diff-catalog';
import { useLiveTranscriptView } from './use-live-transcript';
import { usePromptInboxSnapshot } from './use-prompt-inbox';
import { useTranscriptMetadata } from './use-transcript-metadata';
import { useTranscriptQueries } from './use-transcript-queries';

const EMPTY = {};
const EMPTY_COMMANDS: never[] = [];
const IDLE: SendingState = { active: false };

export function useChatCommands({ client, directory, isCurrentClient, manager, revision, scopeKey }: ReturnType<typeof useProjectScope>) {
  return useMemo<ChatCommands>(() => {
    function read() {
      const binding = manager?.realtime.getProjectSources(directory, scopeKey)?.chat;
      return binding?.isCurrent() && binding.revision === revision && isCurrentClient(client) ? binding.commands : undefined;
    }
    function requireCommands() {
      const commands = read();
      if (!commands) throw new Error('This server is no longer available.');
      return commands;
    }
    return {
      cancelPrompt: async (...args) => requireCommands().cancelPrompt(...args),
      setDiffScope: (...args) => read()?.setDiffScope(...args),
      selectDiffMessage: (...args) => read()?.selectDiffMessage(...args),
      refreshDiffs: async (...args) => { await read()?.refreshDiffs(...args); },
      retryTranscript: async () => { await read()?.retryTranscript(); },
      replyToPermission: async (...args) => requireCommands().replyToPermission(...args),
      replyToQuestion: async (...args) => requireCommands().replyToQuestion(...args),
      rejectQuestion: async (...args) => requireCommands().rejectQuestion(...args),
      executeCommand: async (...args) => requireCommands().executeCommand(...args),
      executeShell: async (...args) => requireCommands().executeShell(...args),
      switchSessionModel: async (...args) => requireCommands().switchSessionModel(...args),
      switchSessionAgent: async (...args) => requireCommands().switchSessionAgent(...args),
      sendPrompt: async (...args) => requireCommands().sendPrompt(...args),
      abortSession: async (...args) => requireCommands().abortSession(...args),
      clearPromptError: () => read()?.clearPromptError(),
      loadOlderMessages: async (...args) => { await read()?.loadOlderMessages(...args); },
    };
  }, [client, directory, isCurrentClient, manager, revision, scopeKey]);
}

export function useChatTranscript(scope: ReturnType<typeof useProjectScope>, currentSessionId?: string, conversationSessionId?: string, observe = true) {
  const { client, identity, scopeKey } = scope;
  const { messagesBySession: canonical, messageWindows } = useTranscriptQueries(identity, client, observe ? currentSessionId : undefined, conversationSessionId, observe);
  const messagesBySession = useLiveTranscriptView(scopeKey, liveTranscriptPartition(identity, client), canonical, observe);
  return { messagesBySession, messageWindows };
}

export function useChat() {
  const scope = useProjectScope();
  const { identity, client, directory, settings, scopeKey } = scope;
  const selection = useAppStore((state) => state.selection[scopeKey]);
  const currentSessionId = selection?.currentSessionId;
  const chat = useAppStore((state) => state.chat[scopeKey]);
  const prompt = useAppStore((state) => state.prompt[scopeKey]);
  const transcript = useAppStore((state) => state.transcriptUi[scopeKey]);
  const conversationSessionId = useAppStore((state) => state.conversation[scopeKey]?.sessionId);
  const { sessions } = useSessionCatalog(identity, client);
  const approvals = useApprovalsCatalog(identity, client);
  const diffs = useDiffCatalog(identity, client);
  const { messagesBySession, messageWindows } = useChatTranscript(scope, currentSessionId, conversationSessionId);
  const metadata = useTranscriptMetadata(identity, client);
  const inbox = usePromptInboxSnapshot(identity, client, JSON.stringify([identity.connectionId, directory, settings.connect ? settings.serverUrl : '']));
  const { availableModels, availableSkills, availableReferences } = useCapabilitiesCatalog(identity, client, true, false);
  const { data: commands = EMPTY_COMMANDS } = useQuery({ ...commandsOptions(identity, client), enabled: false });
  const actions = useChatCommands(scope);
  const view = useChatPresentation({
    ...actions, ...approvals, ...diffs, ...metadata, ...inbox,
    commands, availableModels, availableSkills, availableReferences, sessions, currentSessionId, messagesBySession, messageWindows,
    activeSession: currentSessionId ? sessions.find(({ id }) => id === currentSessionId) : undefined,
    serverContract: client.__opencode.contract,
    isBootstrappingChat: selection?.isBootstrappingChat === true,
    isRefreshingMessages: chat?.isRefreshingMessages === true,
    isRefreshingDiffs: chat?.isRefreshingDiffs === true,
    transcriptReadError: currentSessionId ? chat?.readErrors[currentSessionId] : undefined,
    diffScopeBySession: chat?.diffScopeBySession ?? EMPTY,
    selectedDiffMessageBySession: chat?.selectedDiffMessageBySession ?? EMPTY,
    hydratingSessionIds: transcript?.hydratingSessionIds ?? EMPTY,
    loadingOlderBySession: transcript?.loadingOlderBySession ?? EMPTY,
    sendingState: prompt?.sending ?? IDLE,
    promptError: prompt?.error,
  });
  return { view, voiceMessages: conversationSessionId ? messagesBySession[conversationSessionId] : undefined };
}
