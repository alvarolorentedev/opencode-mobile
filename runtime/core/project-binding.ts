import { agentsOptions, capabilitiesOptions, getConfiguredProviderIds } from '@/features/ai/runtime';
import {
  createChatRefresh, createDiffCatalog, createProjectTranscript, pruneProviderTranscripts, readPendingPromptSessionIds,
  type ChatCommands,
} from '@/features/chat/runtime';
import { createProjectCatalogActions } from '@/features/projects/runtime';
import { approvalsAccess, createSessionExecutionActions, sessionCatalogAccess } from '@/features/sessions/runtime';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';
import { commandsOptions, configurationOptions } from '@/shared/server-data/catalogs';
import { mcpOptions } from '@/shared/server-data/diagnostics';

import type { CommandContext } from './commands/context';
import { workspaceChatPreferences } from './commands/connection';
import type { createPromptCommands } from './commands/prompt';
import type { createSessionCommands } from './commands/session';
import type { createTerminalRuntime } from './commands/terminal';
import type { createCoreEvents } from './events';
import { reconcileProjectSessionSelection } from './project-session-selection';
import { EMPTY_CHAT, type ChatUiState } from './store';

type Manager = NonNullable<ReturnType<CommandContext['connections']['get']>>;
export type ProjectRuntimeDependencies = CommandContext & {
  events: ReturnType<typeof createCoreEvents>;
  terminal: ReturnType<typeof createTerminalRuntime>;
  session: ReturnType<typeof createSessionCommands>;
  prompt: ReturnType<typeof createPromptCommands>;
};

export function createProjectBinding(dependencies: ProjectRuntimeDependencies, manager: Manager,
  entry: ConnectionRecord, scopeKey: string, directory: string, schedule: () => void) {
  const { store, queryClient, session, prompt, terminal, events, connections } = dependencies;
  const projectClient = manager.getProjectClient(directory, entry);
  const catalogClient = manager.getCatalogClient();
  if (!projectClient || !catalogClient) return;
  const client = projectClient;

  const { id: connectionId, revision, settings } = entry;
  const identity = { connectionId, connectionScope: getConnectionScope(settings), authRevision: entry.authRevision ?? 0 };
  const target = { connectionId, projectPath: directory };
  const generation = { current: 0 };
  const readState = () => store.getState();
  const selection = () => readState().selection[scopeKey];
  const readEntry = () => readState().registry.connections.find(({ id }) => id === connectionId);
  const [, registeredDirectory] = JSON.parse(scopeKey) as [string, string];
  const readDirectory = () => selection()?.activeProjectPath ?? registeredDirectory;
  const readSettings = () => readEntry()?.settings ?? settings;
  const isCurrent = () => {
    const current = readEntry();
    return generation.current === 0 && current?.enabled === true && current.settings === settings
      && current.revision === revision && (current.authRevision ?? 0) === identity.authRevision && connections.get(connectionId) === manager
      && readDirectory() === directory && manager.getProjectClient(directory, current) === client;
  };
  const isCurrentClient = (candidate: object) => candidate === client && isCurrent();
  const isCurrentCatalogClient = (candidate: object) => generation.current === 0 && connections.get(connectionId) === manager
    && candidate === manager.getCatalogClient() && readSettings() === settings;
  const chat = () => readState().chat[scopeKey] ?? EMPTY_CHAT;
  const chatField = <K extends keyof ChatUiState>(field: K) => (value: ChatUiState[K] | ((current: ChatUiState[K]) => ChatUiState[K])) => {
    if (isCurrent()) readState().setChat(scopeKey, (current) => ({
      [field]: typeof value === 'function' ? (value as (item: ChatUiState[K]) => ChatUiState[K])(current[field]) : value,
    }));
  };
  const currentSessionIdRef = { get current() { return selection()?.currentSessionId; } };
  const { setSelection, setMcpAuthPrompt } = readState();
  const sessions = sessionCatalogAccess(queryClient, identity, client);
  const approvals = approvalsAccess(queryClient, identity, client);
  const diffs = createDiffCatalog(queryClient, identity, client);
  const transcript = createProjectTranscript(dependencies, { identity, scopeKey, client, isCurrentClient, activeProjectPath: directory || undefined });
  const queue = events.createProjectRefreshQueue();
  const inbox = prompt.createInbox();
  const queueScope = JSON.stringify([connectionId, directory, settings.connect ? settings.serverUrl : '']);
  const inboxBinding = { client, identity, scope: queueScope, isCurrentClient,
    readMessages: transcript.readMessages, appendUserMessage: transcript.appendUserMessage };
  const { refreshMessages, submitPrompt, cancelPrompt } = inbox.actions(inboxBinding);
  const promptWorkspace = prompt.workspace(scopeKey);
  const refresh = session.refresh(target, scopeKey, revision);
  const navigation = session.navigation(target, scopeKey, revision);
  const interactions = session.interactions(target, revision);
  const chatRefresh = createChatRefresh({
    ...diffs, client, isCurrentClient, currentSessionIdRef, readDisplayedSession: transcript.readDisplayedSession,
    setIsRefreshingDiffs: chatField('isRefreshingDiffs'),
    setDiffScopeBySession: chatField('diffScopeBySession'),
    setSelectedDiffMessageBySession: chatField('selectedDiffMessageBySession'),
    readPinnedDiffMessage: (id) => chat().selectedDiffMessageBySession[id],
    readDiffScope: (id) => chat().diffScopeBySession[id],
  });
  const refreshActions = { ...refresh, ...chatRefresh, refreshMessages };
  const scheduleSessionRefresh = (id: string, options?: SessionRefreshOptions) => queue.scheduleSession(id, options, refreshActions);
  const scheduleSessionsRefresh = () => queue.scheduleCatalog(refresh.refreshSessions);
  const mcpQueryKey = mcpOptions(identity, client).queryKey;

  function clearProjectState() {
    session.cancelBootstrap(scopeKey);
    queue.clear();
    session.forgetSessionCreation(identity, client);
    setSelection(scopeKey, { currentSessionId: undefined, explicitSessionId: undefined });
    sessions.setSessions([]);
    diffs.setDiffsBySession({});
    diffs.setTodosBySession({});
    diffs.setVcsDiffsByScope({ uncommitted: [], branch: [] });
    transcript.reset();
    approvals.setPermissions({});
    approvals.setQuestions({});
    setMcpAuthPrompt((item) => item?.scopeKey === scopeKey ? undefined : item);
    terminal.get(scopeKey)?.controller.resetTerminal();
  }
  const catalog = createProjectCatalogActions(queryClient, {
    identity, client, catalogClient, isCurrentClient, isCurrentCatalogClient,
    activeProjectPathRef: { get current() { return readDirectory() || undefined; } },
    setActiveProjectPath: (value) => setSelection(scopeKey, (current) => ({
      activeProjectPath: typeof value === 'function' ? value(current.activeProjectPath) : value,
    })),
    clearProjectState, scopeGenerationRef: generation, serverContract: client.__opencode.contract,
    settingsRef: { get current() { return readSettings(); } },
  });

  function commandContext() {
    const discovery = queryClient.getQueryData(capabilitiesOptions(identity, client).queryKey);
    const currentConfig = queryClient.getQueryData(configurationOptions(identity, client).queryKey)?.config;
    const availableAgents = queryClient.getQueryData(agentsOptions(identity, client).queryKey) ?? [];
    const availableModels = discovery?.models ?? [];
    const configured = getConfiguredProviderIds(currentConfig, discovery?.connected ?? [], availableModels);
    const availableProviders = discovery?.providers.map((provider) => ({ ...provider, configured: provider.configured || configured.has(provider.id) })) ?? [];
    const chatPreferences = workspaceChatPreferences(readState().shell.chatPreferences, readEntry()?.preferences);
    return { currentConfig, availableAgents, availableModels, availableProviders, chatPreferences };
  }
  function promptActions(id: string) {
    return promptWorkspace.actions({
      ...commandContext(), ...refreshActions, submitPrompt, client, isCurrentClient,
      activeProjectPath: directory || undefined, connectionScope: identity.connectionScope, readSettings, scheduleSessionRefresh,
      sessions: sessions.readSessions(), sessionStatuses: sessions.readStatuses(),
      messagesBySession: { [id]: transcript.readDisplayedSession(id) },
    });
  }
  function execution() {
    return createSessionExecutionActions({ ...commandContext(), client, isCurrentClient,
      commands: queryClient.getQueryData(commandsOptions(identity, client).queryKey) ?? [],
      sessions: sessions.readSessions(),
      refreshMessages, refreshSessions: refresh.refreshSessions });
  }
  const commandBinding: { revision?: number; isCurrent: () => boolean; commands: ChatCommands } = {
    revision, isCurrent, commands: {
      ...interactions, setDiffScope: chatRefresh.setDiffScope, selectDiffMessage: chatRefresh.selectDiffMessage,
      refreshDiffs: chatRefresh.refreshDiffs, cancelPrompt,
      clearPromptError: promptWorkspace.clearPromptError,
      loadOlderMessages: transcript.loadOlderMessages,
      retryTranscript: async () => {
        const id = currentSessionIdRef.current;
        if (id) await refreshMessages(id, false).catch(() => undefined);
      },
      executeCommand: (...args) => execution().executeCommand(...args),
      executeShell: (...args) => execution().executeShell(...args),
      sendPrompt: (id, ...args) => promptActions(id).sendPrompt(id, ...args),
      abortSession: (id: string) => promptActions(id).abortSession(id),
      switchSessionModel: (id, model) => promptActions(id).switchSessionModel(id, model),
      switchSessionAgent: (id, agent) => promptActions(id).switchSessionAgent(id, agent),
    },
  };
  const catalogBinding = { revision, isCurrent, actions: catalog };
  const scope = manager.realtime.createScope();
  const stopInvalidation = manager.onInvalidated(() => {
    if (generation.current !== 0) return;
    generation.current++;
    clearProjectState();
    promptWorkspace.reset();
    schedule();
  });
  const suspend = () => { generation.current++; queue.clear(); schedule(); };
  let catalogActive = false;
  let bootstrapping = false;
  let heldSession: string | undefined;
  let recentSessionIds: string[] = [];
  let settlement: AbortController | undefined;
  let last: { sessions: ReturnType<typeof sessions.readSessions>; statuses: ReturnType<typeof sessions.readStatuses>;
    sending: ReturnType<typeof readState>['prompt'][string]['sending'] | undefined; explicit?: string; sessionId?: string; voice?: string;
    boot?: boolean; visible: boolean } | undefined;

  function sync(visible: boolean, demanded: boolean) {
    const state = readState();
    const selected = selection();
    const currentSessionId = selected?.currentSessionId;
    const voice = state.conversation[scopeKey];
    const conversationSessionId = voice?.sessionId;
    const sending = state.prompt[scopeKey]?.sending;
    const connected = manager.getState().connection.status === 'connected';
    const sessionList = sessions.readSessions();
    const statuses = sessions.readStatuses();
    const pending = approvals.read();
    const pendingSessionIds = readPendingPromptSessionIds(queryClient, identity, client, state.prompt[queueScope]?.outbox);
    const busy = Boolean(sending?.active || (voice && (voice.phase !== 'off' || voice.readbackPhase !== 'idle')) || pendingSessionIds.length
      || Object.values(statuses).some(({ type }) => type !== 'idle'));
    const busyForUpdates = busy || Boolean(selected?.isBootstrappingChat || state.mcpAuthPrompt?.scopeKey === scopeKey
      || state.terminal[scopeKey]?.instances.length || manager.getState().connection.status === 'connecting'
      || Object.values(pending.permissions).some((items) => items.length) || Object.values(pending.questions).some((items) => items.length));

    scope.update({
      ...refreshActions, workspaceKey: scopeKey, projectPath: directory || undefined, demanded,
      busy, constrained: state.network.constrained, pendingSessionIds, currentSessionId, conversationSessionId,
      binding: { revision, client, suspend, busyForUpdates }, catalog: catalogBinding, chat: commandBinding,
      onEvent: (event) => events.dispatch(event, { workspaceKey: scopeKey, mcpQueryKey, isCurrent, pendingSessionIds,
        actions: { ...refresh, ...diffs, scheduleSessionRefresh, scheduleSessionsRefresh,
          applyTranscriptEvent: transcript.applyEvent, liveTranscriptMessageId: transcript.activeMessageId, isLocalSendRecent: transcript.isLocalSendRecent,
          refreshTerminals: () => terminal.get(scopeKey)?.controller.refreshTerminals() ?? Promise.resolve(),
          setSessions: sessions.setSessions, removeCatalogSession: sessions.removeCatalogSession, setSessionStatuses: sessions.setSessionStatuses,
          setPendingPermissionsBySession: approvals.setPermissions, setPendingQuestionsBySession: approvals.setQuestions,
        },
      }),
      refreshLiveMessages: (id) => {
        const messageId = transcript.activeMessageId(id);
        return messageId ? refreshMessages(id, true, { messageId }) : Promise.resolve();
      },
      beginHydration: transcript.beginHydration,
      hasMessages: (id) => transcript.readDisplayedSession(id).length > 0,
    });
    inbox.configure({ ...inboxBinding, connected, online: state.network.online });

    if (demanded && connected && !catalogActive) void catalog.refreshProjectCatalog(true).catch(() => undefined);
    catalogActive = demanded && connected;
    const ready = Boolean(visible && connected && directory);
    if (ready && !bootstrapping) {
      void navigation.ensureActiveSession().catch((error) => {
        if (isCurrent()) promptWorkspace.setPromptError({ message: error instanceof Error ? error.message : 'Could not load this project.',
          occurredAt: dependencies.clock() });
      });
    }
    bootstrapping = ready;

    if (heldSession !== currentSessionId) {
      heldSession = currentSessionId;
      if (currentSessionId) recentSessionIds = [currentSessionId, ...recentSessionIds.filter((id) => id !== currentSessionId)].slice(0, 3);
      transcript.hydrate(currentSessionId, () => currentSessionIdRef.current === currentSessionId);
    }
    if (last?.sessions !== sessionList || last.sessionId !== currentSessionId || last.explicit !== selected?.explicitSessionId) {
      reconcileProjectSessionSelection({
        sessions: sessionList, currentSessionId, explicitSessionId: selected?.explicitSessionId,
        setCurrentSessionId: (id) => setSelection(scopeKey, { currentSessionId: id }),
        clearExplicitSessionId: () => setSelection(scopeKey, { explicitSessionId: undefined }),
      });
    }
    if (last?.statuses !== statuses || last.sessionId !== currentSessionId || last.voice !== conversationSessionId
      || last.boot !== selected?.isBootstrappingChat || last.visible !== visible) {
      pruneProviderTranscripts({
        visible, isBootstrappingChat: selected?.isBootstrappingChat === true, pendingDeepLinkTargetRef: { current: selected?.pendingDeepLink },
        currentSessionId, conversationSessionId, recentSessionIds, sessionStatuses: statuses, ...diffs, pruneTranscript: transcript.prune,
      });
    }
    if (last?.sessions !== sessionList || last.statuses !== statuses || last.sending !== sending) {
      settlement?.abort();
      settlement = new AbortController();
      void promptWorkspace.reconcileSettlement({ client, isCurrentClient, activeProjectPath: directory || undefined,
        connectionScope: identity.connectionScope, sessions: sessionList, sessionStatuses: statuses }, settlement.signal)
        .catch((reason) => console.warn('Could not complete task notification.', reason));
    }
    last = { sessions: sessionList, statuses, sending, explicit: selected?.explicitSessionId, sessionId: currentSessionId,
      voice: conversationSessionId, boot: selected?.isBootstrappingChat, visible };
  }

  return {
    isCurrent, sync,
    dispose() {
      generation.current++;
      stopInvalidation();
      scope.dispose();
      settlement?.abort();
      queue.clear();
      inbox.dispose();
      promptWorkspace.reset();
      transcript.dispose();
      session.cancelBootstrap(scopeKey);
    },
  };
}
