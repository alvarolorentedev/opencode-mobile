import type { FilePartInput, GlobalEvent, TextPartInput } from '@opencode-ai/sdk/v2/client';
import type { Command, Config, File, FileContent, FileDiff, Project, Session, SessionStatus, Todo, VcsInfo } from '@/lib/opencode/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';

import {
  buildClient,
  defaultConnectionSettings,
  getConnectionError,
  getNormalizedServerUrl,
  listPendingInteractions,
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  type PendingPermissionRequest,
  type PendingQuestionAnswer,
  type PendingQuestionRequest,
  type OpencodeConnectionSettings,
} from '@/lib/opencode/client';
import {
  toTranscriptEntry,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import {
  clearPendingTaskFinishedNotification,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
} from '@/lib/notifications';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import {
  startWorkingSoundAsync,
  stopWorkingSoundAsync,
  unloadWorkingSoundAsync,
} from '@/lib/voice/working-sound';
import {
  buildSystemPrompt,
  defaultChatPreferences,
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  getProjectLabel,
  getSelectedModelParts,
  groupPendingRequestsBySession,
  isAutoApproveEnabled,
  mergePermissionConfig,
} from '@/providers/opencode-provider-utils';
import {
  getConfiguredProviders,
  getConversationStatusLabel,
  getCurrentPendingRequests,
  getSessionPreviewById,
  getTranscript,
  getTranscriptActivityLabelForEntries,
} from '@/providers/opencode-provider-selectors';
import {
  CONVERSATION_FINAL_RESULT_SETTLE_MS,
  CONVERSATION_KEEP_AWAKE_TAG,
  CONVERSATION_LISTENING_RESTART_MS,
  type AgentOption,
  type ChatPreferences,
  type ConnectionState,
  type ConversationPhase,
  type ModelOption,
  type OpencodeContextValue,
  type OpencodeProject,
  type ProviderAuthMethod,
  type ProviderOption,
  type WorkspaceCatalog,
} from '@/providers/opencode-provider-types';
import { useConversationKeepAwake } from '@/providers/use-conversation-keep-awake';
import { useConversationScreenDim } from '@/providers/use-conversation-screen-dim';
import { useOpencodePersistence } from '@/providers/use-opencode-persistence';
import {
  loadWorkspaceCatalog as svcLoadWorkspaceCatalog,
  listSessions as svcListSessions,
  getSessionMessages as svcGetSessionMessages,
  getSessionDiff as svcGetSessionDiff,
  getSessionTodos as svcGetSessionTodos,
  deleteSession as svcDeleteSession,
  executeCommand as svcExecuteCommand,
  forkSession as svcForkSession,
  listCommands as svcListCommands,
  revertSession as svcRevertSession,
  shareSession as svcShareSession,
  unrevertSession as svcUnrevertSession,
  unshareSession as svcUnshareSession,
  updateSessionTitle as svcUpdateSessionTitle,
} from '@/providers/services/session-service';
import { loadDiagnostics, type Diagnostics } from '@/providers/services/diagnostics-service';
import { findFiles, getFileStatus, getVcsInfo, readFile } from '@/providers/services/workspace-service';

export type {
  AgentOption,
  ChatPreferences,
  ConnectionState,
  ConversationPhase,
  ConversationState,
  ModelOption,
  OpencodeContextValue,
  OpencodeProject,
  ProviderAuthMethod,
  ProviderOption,
  ReasoningLevel,
  ResponseScope,
} from '@/providers/opencode-provider-types';

const OpencodeContext = createContext<OpencodeContextValue | null>(null);

export function OpencodeProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<OpencodeConnectionSettings>(defaultConnectionSettings);
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'idle',
    message: 'Add a server URL and connect to OpenCode.',
  });
  const [activeProjectPath, setActiveProjectPath] = useState<string>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, SessionMessageRecord[]>>({});
  const [diffsBySession, setDiffsBySession] = useState<Record<string, FileDiff[]>>({});
  const [todosBySession, setTodosBySession] = useState<Record<string, Todo[]>>({});
  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<Record<string, PendingPermissionRequest[]>>({});
  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, PendingQuestionRequest[]>>({});
  const [serverProjects, setServerProjects] = useState<Project[]>([]);
  const [currentProjectPath, setCurrentProjectPath] = useState<string>();
  const [serverRootPath, setServerRootPath] = useState<string>();
  // browsing server folders removed
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);
  const [isRefreshingWorkspaceCatalog, setIsRefreshingWorkspaceCatalog] = useState(false);
  // browsing removed
  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);
  const [sendingState, setSendingState] = useState<{ sessionId?: string; active: boolean }>({ active: false });
  const [promptError, setPromptError] = useState<{ message: string; occurredAt: number; sessionId?: string }>();
  const pendingNotificationSessionIdsRef = useRef<Set<string>>(new Set());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  const [currentConfig, setCurrentConfig] = useState<Config>();
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [providerAuthMethodsById, setProviderAuthMethodsById] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const [lastSessionByProject, setLastSessionByProject] = useState<Record<string, string>>({});
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>('off');
  const [conversationSessionId, setConversationSessionId] = useState<string>();
  const [queuedConversationPrompt, setQueuedConversationPrompt] = useState<string>();
  const [pendingConversationTurn, setPendingConversationTurn] = useState<string>();
  const [conversationFeedback, setConversationFeedback] = useState<string>();
  const [conversationLatestHeardText, setConversationLatestHeardText] = useState<string>();
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [commands, setCommands] = useState<Command[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceFileStatuses, setWorkspaceFileStatuses] = useState<File[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<{ path: string; content: FileContent }>();
  const [vcsInfo, setVcsInfo] = useState<VcsInfo>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();

  const settingsRef = useRef(settings);
  const activeProjectPathRef = useRef(activeProjectPath);
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const conversationPhaseRef = useRef<ConversationPhase>('off');
  const assistantReplyBaselineIdRef = useRef<string | undefined>(undefined);
  const conversationResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationFinalResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationListeningRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationCancelRequestedRef = useRef(false);
  const conversationSubmittingRef = useRef(false);
  const pendingConversationTranscriptRef = useRef<string | undefined>(undefined);
  const flushPendingConversationResultRef = useRef<() => void>(() => undefined);
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, { messages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean }>>({});
  settingsRef.current = settings;
  activeProjectPathRef.current = activeProjectPath;

  const clearPendingConversationResult = useCallback(() => {
    pendingConversationTranscriptRef.current = undefined;
    if (conversationFinalResultTimeoutRef.current) {
      clearTimeout(conversationFinalResultTimeoutRef.current);
      conversationFinalResultTimeoutRef.current = undefined;
    }
  }, []);

  const { isHydrated } = useOpencodePersistence({
    defaultChatPreferences,
    defaultSettings: defaultConnectionSettings,
    activeProjectPath,
    chatPreferences,
    lastSessionByProject,
    setActiveProjectPath,
    setChatPreferences,
    setLastSessionByProject,
    setSettings,
    settings,
  });

  const projects = useMemo<OpencodeProject[]>(() => {
    const entries = new Map<string, OpencodeProject>();

    serverProjects.forEach((project) => {
      entries.set(project.worktree, {
        id: project.id,
        label: getProjectLabel(project.worktree),
        path: project.worktree,
        source: 'server',
        updatedAt: project.time.initialized || project.time.created,
        isCurrent: project.worktree === currentProjectPath,
      });
    });

    if (activeProjectPath && !entries.has(activeProjectPath)) {
      entries.set(activeProjectPath, {
        label: getProjectLabel(activeProjectPath),
        path: activeProjectPath,
        source: 'server',
        isCurrent: activeProjectPath === currentProjectPath,
      });
    }

    return [...entries.values()].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  }, [activeProjectPath, currentProjectPath, serverProjects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.path === activeProjectPath),
    [activeProjectPath, projects],
  );

  const client = useMemo(
    () => buildClient({ ...settings, directory: activeProjectPath || '' }),
    [activeProjectPath, settings],
  );
  const catalogClient = useMemo(() => buildClient({ ...settings, directory: '' }), [settings]);

  // browseServerPath stub removed

  const loadWorkspaceCatalog = useCallback(
    async (silent = false): Promise<WorkspaceCatalog> => {
      if (!silent) {
        setIsRefreshingWorkspaceCatalog(true);
      }

      try {
        const result = await svcLoadWorkspaceCatalog(catalogClient);
        setServerProjects(result.serverProjects as Project[]);
        setCurrentProjectPath(result.currentProjectPath);
        setServerRootPath(result.serverRootPath);
        setActiveProjectPath((current) => current || result.currentProjectPath || result.serverProjects[0]?.worktree);
        return result;
      } finally {
        if (!silent) {
          setIsRefreshingWorkspaceCatalog(false);
        }
      }
    },
    [catalogClient],
  );

  const refreshWorkspaceCatalog = useCallback(
    async (silent = false) => {
      await loadWorkspaceCatalog(silent);
    },
    [loadWorkspaceCatalog],
  );

  const fetchSessions = useCallback(
    async (silent = false) => {
      if (!activeProjectPath) {
        setSessions([]);
        setSessionStatuses({});
        return [];
      }

      if (!silent) {
        setIsRefreshingSessions(true);
      }

      try {
        const result = await svcListSessions(client);
        setSessions(result.sessions);
        setSessionStatuses(result.statuses);
        return result.sessions;
      } finally {
        if (!silent) {
          setIsRefreshingSessions(false);
        }
      }
    },
    [activeProjectPath, client],
  );

  const refreshSessions = useCallback(
    async (silent = false) => {
      await fetchSessions(silent);
    },
    [fetchSessions],
  );

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false) => {
      if (!silent) {
        setIsRefreshingMessages(true);
      }

      try {
        const data = await svcGetSessionMessages(client, sessionId);
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
      }
    },
    [client],
  );

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const data = await svcGetSessionDiff(client, sessionId);
        setDiffsBySession((current) => ({
          ...current,
          [sessionId]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client],
  );

  const refreshPendingInteractions = useCallback(async () => {
    const { permissions, questions } = await listPendingInteractions(client);
    setPendingPermissionsBySession(groupPendingRequestsBySession(permissions));
    setPendingQuestionsBySession(groupPendingRequestsBySession(questions));
  }, [client]);

  const scheduleSessionRefresh = useCallback(
    (sessionId: string, options?: { messages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean; delayMs?: number }) => {
      if (!sessionId) {
        return;
      }

      const existing = sessionRefreshTimeoutsRef.current[sessionId];
      if (existing) {
        clearTimeout(existing);
      }

      const pending = sessionRefreshOptionsRef.current[sessionId] || {};
      sessionRefreshOptionsRef.current[sessionId] = {
        messages: pending.messages || options?.messages,
        diff: pending.diff || options?.diff,
        todos: pending.todos || options?.todos,
        sessions: pending.sessions || options?.sessions,
      };

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];
        const mergedOptions = sessionRefreshOptionsRef.current[sessionId] || {};
        delete sessionRefreshOptionsRef.current[sessionId];

        if (mergedOptions.sessions) {
          void refreshSessions(true);
        }
        if (mergedOptions.messages) {
          void refreshMessages(sessionId, true);
        }
        if (mergedOptions.diff) {
          void refreshSessionDiff(sessionId, true);
        }
        if (mergedOptions.todos) {
          void refreshSessionTodos(sessionId);
        }
      }, options?.delayMs ?? 150);
    },
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const refreshChatCapabilities = useCallback(async () => {
    const result = await import('@/providers/services/capabilities-service').then((m) => m.discoverChatCapabilities(client, activeProjectPath));

    setCurrentConfig(result.config);
    setAvailableProviders(result.providers);
    setProviderAuthMethodsById(result.providerAuthMethodsById);
    setAvailableModels(result.models);
    setAvailableAgents(result.agents);

    setChatPreferences((current) => {
      const configuredProviderIds = getConfiguredProviderIds(result.config, result.connected, result.models);
      const configuredModels = result.models.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = getInitialProviderId(configuredModels, result.config, current.providerId, current.modelId);
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, result.config, current.providerId, current.modelId);

      return {
        ...current,
        mode: getInitialMode(result.agents, result.config, current.mode),
        providerId: safeProviderId,
        modelId: getModelIdForProvider(
          enabledModels,
          safeProviderId,
          getInitialModelId(enabledModels, result.config, current.modelId),
          safeProviderId ? current.providerModelSelections[safeProviderId] : undefined,
        ),
        enabledModelIds,
        autoApprove: isAutoApproveEnabled(result.config),
      };
    });
  }, [activeProjectPath, client]);

  const openSession = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      if (activeProjectPath) {
        setLastSessionByProject((current) => ({
          ...current,
          [activeProjectPath]: sessionId,
        }));
      }
      await Promise.all([refreshMessages(sessionId), refreshSessionDiff(sessionId, true), refreshSessionTodos(sessionId), refreshPendingInteractions()]);
    },
    [activeProjectPath, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos],
  );

  const createSession = useCallback(
    async (title?: string) => {
      const trimmedTitle = title?.trim();
      const response = trimmedTitle
        ? await client.session.create({ title: trimmedTitle })
        : await client.session.create();

      if (!response.data) {
        throw new Error('OpenCode did not return the created session.');
      }
      await refreshSessions(true);
      return response.data;
    },
    [client, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await svcDeleteSession(client, sessionId);
      setMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setDiffsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setTodosBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingPermissionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingQuestionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      if (currentSessionId === sessionId) {
        setCurrentSessionId(undefined);
      }
      await refreshSessions(true);
    },
    [client, currentSessionId, refreshSessions],
  );

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error('Enter a session title.');
    }
    await svcUpdateSessionTitle(client, sessionId, trimmed);
    await refreshSessions(true);
  }, [client, refreshSessions]);

  const forkSession = useCallback(async (sessionId: string, messageId?: string) => {
    const forked = await svcForkSession(client, sessionId, messageId);
    if (!forked) {
      throw new Error('OpenCode did not return the forked session.');
    }
    await refreshSessions(true);
    await openSession(forked.id);
    return forked;
  }, [client, openSession, refreshSessions]);

  const shareSession = useCallback(async (sessionId: string) => {
    const shared = await svcShareSession(client, sessionId);
    if (!shared) {
      throw new Error('OpenCode did not return the shared session.');
    }
    await refreshSessions(true);
    return shared;
  }, [client, refreshSessions]);

  const unshareSession = useCallback(async (sessionId: string) => {
    const unshared = await svcUnshareSession(client, sessionId);
    if (!unshared) {
      throw new Error('OpenCode did not return the session.');
    }
    await refreshSessions(true);
    return unshared;
  }, [client, refreshSessions]);

  const revertSession = useCallback(async (sessionId: string, messageId: string) => {
    await svcRevertSession(client, sessionId, messageId);
    await Promise.all([refreshSessions(true), refreshMessages(sessionId, true), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshMessages, refreshSessionDiff, refreshSessions]);

  const unrevertSession = useCallback(async (sessionId: string) => {
    await svcUnrevertSession(client, sessionId);
    await Promise.all([refreshSessions(true), refreshMessages(sessionId, true), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshMessages, refreshSessionDiff, refreshSessions]);

  const refreshServerFeatures = useCallback(async () => {
    if (!activeProjectPath) {
      setCommands([]);
      setWorkspaceFileStatuses([]);
      setVcsInfo(undefined);
      return;
    }
    const [nextCommands, nextStatuses, nextVcs] = await Promise.all([
      svcListCommands(client).catch(() => []),
      getFileStatus(client).catch(() => []),
      getVcsInfo(client).catch(() => undefined),
    ]);
    setCommands(nextCommands || []);
    setWorkspaceFileStatuses(nextStatuses || []);
    setVcsInfo(nextVcs);
  }, [activeProjectPath, client]);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await loadDiagnostics(catalogClient));
  }, [catalogClient]);

  const searchWorkspaceFiles = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const nextFiles = trimmed ? (await findFiles(client, trimmed)) || [] : [];
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setWorkspaceFiles(nextFiles);
    }
  }, [client]);

  const openWorkspaceFile = useCallback(async (path: string) => {
    const content = await readFile(client, path);
    if (!content) {
      throw new Error('OpenCode did not return file content.');
    }
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setSelectedWorkspaceFile({ path, content });
    }
  }, [client]);

  const executeCommand = useCallback(async (sessionId: string, command: string, args: string) => {
    const selected = getSelectedModelParts(chatPreferences.modelId);
    await svcExecuteCommand(client, sessionId, command, args, {
      agent: chatPreferences.mode,
      model: selected ? `${selected.providerID}/${selected.modelID}` : undefined,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]);
  }, [chatPreferences.mode, chatPreferences.modelId, client, refreshMessages, refreshSessions]);

  const summarizeSessionTitle = useCallback(
    async (sessionId: string, knownSessions?: Session[]) => {
      const existingSession = (knownSessions || sessions).find((session) => session.id === sessionId);
      if (existingSession?.title?.trim()) {
        return existingSession;
      }

      const selectedModel = getSelectedModelParts(chatPreferences.modelId);
      if (!selectedModel) {
        return existingSession;
      }

      await client.session.summarize({ sessionID: sessionId, ...selectedModel });

      const nextSessions = await fetchSessions(true);
      return nextSessions.find((session) => session.id === sessionId);
    },
    [chatPreferences.modelId, client, fetchSessions, sessions],
  );

  const ensureActiveSession = useCallback(async () => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return undefined;
    }

    if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) {
      if (!messagesBySession[currentSessionId]) {
        await refreshMessages(currentSessionId, true);
      }
      return currentSessionId;
    }

    if (bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapPromise = (async () => {
      setIsBootstrappingChat(true);

      try {
        const nextSessions = sessions.length > 0 ? sessions : await fetchSessions(true);
        const rememberedSessionId = activeProjectPath ? lastSessionByProject[activeProjectPath] : undefined;
        const targetSession =
          nextSessions.find((session) => session.id === rememberedSessionId) ??
          nextSessions[0] ??
          (await createSession());
        setCurrentSessionId(targetSession.id);
        if (activeProjectPath) {
          setLastSessionByProject((current) => ({
            ...current,
            [activeProjectPath]: targetSession.id,
          }));
        }
        await Promise.all([
          refreshMessages(targetSession.id, true),
          refreshSessionDiff(targetSession.id, true),
          refreshSessionTodos(targetSession.id),
        ]);
        return targetSession.id;
      } finally {
        setIsBootstrappingChat(false);
        bootstrapPromiseRef.current = null;
      }
    })();

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }, [
    activeProjectPath,
    connection.status,
    createSession,
    currentSessionId,
    fetchSessions,
    lastSessionByProject,
    messagesBySession,
    refreshMessages,
    refreshSessionDiff,
    refreshSessionTodos,
    sessions,
  ]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    setActiveProjectPath(normalizedPath);
    setCurrentSessionId(undefined);
    setWorkspaceFiles([]);
    setWorkspaceFileStatuses([]);
    setSelectedWorkspaceFile(undefined);
    setVcsInfo(undefined);
  }, []);

  const connect = useCallback(async () => {
    setConnection({
      status: 'connecting',
      message: `Connecting to ${getNormalizedServerUrl(settingsRef.current.serverUrl)}...`,
    });

    try {
      const catalog = await loadWorkspaceCatalog(true);
      const projectDirectory = catalog.currentProjectPath || catalog.serverRootPath;

      setConnection({
        status: 'connected',
        message: `Connected to ${getNormalizedServerUrl(settingsRef.current.serverUrl)}`,
        checkedAt: Date.now(),
        projectDirectory,
      });

      // browsing removed

      if (activeProjectPath || catalog.currentProjectPath || catalog.serverProjects[0]?.worktree) {
        await Promise.all([fetchSessions(true), refreshChatCapabilities(), refreshServerFeatures(), refreshDiagnostics()]);
      } else {
        setSessions([]);
        setSessionStatuses({});
        setCurrentConfig(undefined);
        setAvailableProviders([]);
        setProviderAuthMethodsById({});
        setAvailableModels([]);
        setAvailableAgents([]);
      }
    } catch (error) {
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setConnection({
        status: 'error',
        message: getConnectionError(settingsRef.current.serverUrl, error),
        checkedAt: Date.now(),
      });
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
    }
  }, [activeProjectPath, fetchSessions, loadWorkspaceCatalog, refreshChatCapabilities, refreshDiagnostics, refreshServerFeatures]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void connect();
  }, [connect, isHydrated]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    void ensureActiveSession();
  }, [activeProjectPath, connection.status, ensureActiveSession]);

  const refreshCurrentSession = useCallback(
    async (silent = false) => {
      if (!currentSessionId) {
        return;
      }

      await Promise.all([
        refreshSessions(silent),
        refreshMessages(currentSessionId, silent),
        refreshSessionDiff(currentSessionId, true),
        refreshSessionTodos(currentSessionId),
        refreshPendingInteractions(),
      ]);
    },
    [currentSessionId, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const refreshCurrentTodos = useCallback(
    async (_silent = false) => {
      if (!currentSessionId) {
        return;
      }

      await refreshSessionTodos(currentSessionId);
    },
    [currentSessionId, refreshSessionTodos],
  );

  const replyToPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject') => {
      const request = Object.values(pendingPermissionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This permission request is no longer available.');
      }
      await replyToPendingPermission(client, request.id, reply);
      setPendingPermissionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingPermissionsBySession, refreshMessages],
  );

  const replyToQuestion = useCallback(
    async (requestId: string, answers: PendingQuestionAnswer[]) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await replyToPendingQuestion(client, request.id, answers);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await rejectPendingQuestion(client, request.id);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages],
  );

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
    setChatPreferences((current) => {
      const configuredProviderIds = new Set(availableProviders.filter((provider) => provider.configured).map((provider) => provider.id));
      const configuredModels = availableModels.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, patch.enabledModelIds ?? current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = patch.providerId ?? current.providerId;
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, undefined, current.providerId, patch.modelId ?? current.modelId);
      const requestedModelId = patch.modelId ?? current.modelId;
      const nextProviderModelSelections = patch.modelId
        ? {
            ...current.providerModelSelections,
            [patch.providerId ?? safeProviderId ?? patch.modelId.split('/')[0]]: patch.modelId,
          }
        : current.providerModelSelections;
      const nextModelId = getModelIdForProvider(
        enabledModels,
        safeProviderId,
        requestedModelId,
        safeProviderId ? nextProviderModelSelections[safeProviderId] : undefined,
      );

      return {
        ...current,
        ...patch,
        providerId: safeProviderId,
        modelId: nextModelId,
        enabledModelIds,
        providerModelSelections:
          safeProviderId && nextModelId
            ? {
                ...nextProviderModelSelections,
                [safeProviderId]: nextModelId,
              }
            : nextProviderModelSelections,
      };
    });
  }, [availableModels, availableProviders]);

  const configureProvider = useCallback(
    async (providerId: string) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      if (!latestConfig) {
        throw new Error('OpenCode did not return its configuration.');
      }
      const enabledProviders = new Set(latestConfig.enabled_providers || []);
      enabledProviders.add(providerId);

      const updatedConfig = (await client.config.update({
        config: { ...latestConfig, enabled_providers: [...enabledProviders].sort() },
      })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      await refreshChatCapabilities();
      setChatPreferences((current) => ({
        ...current,
        providerId: current.providerId || providerId,
      }));
    },
    [client, currentConfig, refreshChatCapabilities],
  );

  const setProviderAuth = useCallback(
    async (providerId: string, values: Record<string, string>) => {
      const key = values.key?.trim();
      const token = values.token?.trim();
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      const auth = token
        ? { type: 'wellknown' as const, key, token }
        : { type: 'api' as const, key };

      await client.auth.set({ providerID: providerId, auth });
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, configureProvider, refreshChatCapabilities],
  );

  const startProviderOAuth = useCallback(
    async (providerId: string, methodIndex: number, inputs?: Record<string, string>) => {
      const authorization = (await client.provider.oauth.authorize({
        providerID: providerId,
        method: methodIndex,
        inputs,
      })).data;
      if (!authorization) {
        throw new Error('OpenCode did not return OAuth authorization details.');
      }

      return {
        url: authorization.url,
        instructions: authorization.instructions,
        method: authorization.method,
      };
    },
    [client],
  );

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    await client.provider.oauth.callback({
      providerID: providerId,
      method: methodIndex,
      code: code.trim() || undefined,
    });
    await configureProvider(providerId);
    await refreshChatCapabilities();
  }, [client, configureProvider, refreshChatCapabilities]);

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const updatedConfig = (await client.config.update({ config: nextConfig })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      setChatPreferences((current) => ({
        ...current,
        autoApprove: enabled,
      }));
    },
    [client, currentConfig],
  );

  const sendPrompt = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments?: { uri: string; mime?: string; filename?: string }[],
    ) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt && (!attachments || attachments.length === 0)) {
        return false;
      }

      if (promptSubmissionRef.current.active) {
        return false;
      }

      promptSubmissionRef.current = { active: true, sessionId };
      setPromptError(undefined);

      const currentSession = sessions.find((session) => session.id === sessionId);

      pendingNotificationSessionIdsRef.current.add(sessionId);
      if (activeProjectPath) {
        await trackPendingTaskFinishedNotification({
          sessionId,
          sessionTitle: currentSession?.title,
          projectPath: activeProjectPath,
          settings: {
            serverUrl: settingsRef.current.serverUrl,
            username: settingsRef.current.username,
            password: settingsRef.current.password,
          },
          requestedAt: Date.now(),
        });
      }

      setSendingState({ active: true, sessionId });
      let promptAccepted = false;

      try {
        const selectedModel = availableModels.find((model) => model.id === chatPreferences.modelId);
        if (attachments?.length && selectedModel && !selectedModel.supportsAttachments) {
          throw new Error(`${selectedModel.label} does not support file attachments.`);
        }
        if (attachments?.length && selectedModel?.inputModalities?.length) {
          const unsupported = attachments.find((attachment) => {
            const mime = attachment.mime || '';
            const modality = mime.startsWith('image/') ? 'image'
              : mime.startsWith('audio/') ? 'audio'
                : mime.startsWith('video/') ? 'video'
                  : mime === 'application/pdf' ? 'pdf'
                    : undefined;
            return modality && !selectedModel.inputModalities.includes(modality);
          });
          if (unsupported) {
            throw new Error(`${selectedModel.label} does not support ${unsupported.mime || 'this attachment type'} input.`);
          }
        }

        // Prepare file parts. For local URIs (file://, content://, asset://) read the
        // file and convert it to a data URL so the server receives the attachment bytes.
        // Mobile-local URIs are not reachable from the OpenCode server.
        const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const filename = att.filename || att.uri.split('/').pop();
            const mime = att.mime || 'application/octet-stream';

            // Remote and picker-provided data URLs are already server-readable.
            if (/^(?:https?:\/\/|data:)/i.test(att.uri)) {
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
              continue;
            }

            try {
              const FileSystem = await import('expo-file-system/legacy');
              const info = await FileSystem.getInfoAsync(att.uri);
              if (info.exists && typeof info.size === 'number' && info.size > 10 * 1024 * 1024) {
                throw new Error('File exceeds the 10 MB attachment limit.');
              }
              const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: 'base64' });
              const dataUrl = `data:${mime};base64,${base64}`;
              preparedFileParts.push({ type: 'file', mime, filename, url: dataUrl });
            } catch (error) {
              const reason = error instanceof Error ? error.message : 'unknown error';
              throw new Error(`Could not read attachment${filename ? ` \"${filename}\"` : ''}: ${reason}`);
            }
          }
        }

        const parts: (TextPartInput | FilePartInput)[] = [];
        if (trimmedPrompt) {
          parts.push({ type: 'text', text: trimmedPrompt });
        }
        parts.push(...preparedFileParts);

        await client.session.promptAsync({
          sessionID: sessionId,
          agent: chatPreferences.mode,
          model: getSelectedModelParts(chatPreferences.modelId),
          system: buildSystemPrompt(chatPreferences),
          parts,
        });
        promptAccepted = true;
        promptSubmissionRef.current = { active: false, sessionId: undefined };

        setCurrentSessionId(sessionId);
        const nextSessions = await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
        ]);

        const currentSession = nextSessions.find((session) => session.id === sessionId);
        if (!currentSession?.title?.trim()) {
          try {
            await summarizeSessionTitle(sessionId, nextSessions);
          } catch {
            // Leave the session untitled if summarization is unavailable.
          }
        }
        return true;
      } catch (error) {
        promptSubmissionRef.current = { active: false, sessionId: undefined };
        setPromptError({
          message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
          occurredAt: Date.now(),
          sessionId,
        });
        if (!promptAccepted) {
          pendingNotificationSessionIdsRef.current.delete(sessionId);
          await clearPendingTaskFinishedNotification(sessionId);
        }

        throw error;
      } finally {
        setSendingState({ active: false, sessionId: undefined });
      }
    },
    [activeProjectPath, availableModels, chatPreferences, client, fetchSessions, refreshMessages, refreshSessionDiff, refreshSessionTodos, sessions, summarizeSessionTitle],
  );

  const abortSession = useCallback(
    async (sessionId: string) => {
      pendingNotificationSessionIdsRef.current.delete(sessionId);
      await clearPendingTaskFinishedNotification(sessionId);
      await client.session.abort({ sessionID: sessionId });

      await Promise.all([
        refreshSessions(true),
        refreshMessages(sessionId, true),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
      ]);
    },
    [client, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const speechInput = useSpeechInput({
    levelStep: 2,
    locale: chatPreferences.speechLocale,
    onResult: (transcript, isFinal) => {
      if (conversationPhaseRef.current !== 'listening') {
        return;
      }

      const nextTranscript = transcript.trim();
      if (!nextTranscript) {
        return;
      }

      pendingConversationTranscriptRef.current = nextTranscript;
      setConversationLatestHeardText(nextTranscript);
      if (conversationFinalResultTimeoutRef.current) {
        clearTimeout(conversationFinalResultTimeoutRef.current);
        conversationFinalResultTimeoutRef.current = undefined;
      }

      if (isFinal) {
        conversationFinalResultTimeoutRef.current = setTimeout(() => {
          conversationFinalResultTimeoutRef.current = undefined;
          flushPendingConversationResultRef.current();
        }, CONVERSATION_FINAL_RESULT_SETTLE_MS);
      }
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
    volumeUpdateIntervalMillis: 400,
  });
  const {
    abort: abortSpeechInput,
    error: speechInputError,
    errorCode: speechInputErrorCode,
    isListening: isConversationListening,
    isStarting: isConversationListeningStarting,
    level: conversationListeningLevel,
    start: startSpeechInput,
  } = speechInput;

  const flushPendingConversationResult = useCallback(() => {
    const transcript = pendingConversationTranscriptRef.current?.trim();
    clearPendingConversationResult();
    if (!transcript || conversationPhaseRef.current !== 'listening') {
      return;
    }

    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    abortSpeechInput();
    setPendingConversationTurn(transcript);
    setConversationPhase('submitting');
  }, [abortSpeechInput, clearPendingConversationResult]);
  flushPendingConversationResultRef.current = flushPendingConversationResult;

  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => {
      if (!sessionId) {
        return undefined;
      }

        const transcript = (messagesBySession[sessionId] || []).map(toTranscriptEntry).filter(isTranscriptDisplayMessage);
      return [...transcript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim());
    },
    [messagesBySession],
  );

  const clearConversationFeedback = useCallback(() => {
    setConversationFeedback(undefined);
  }, []);

  const stopConversationMode = useCallback(async () => {
    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    conversationSubmittingRef.current = false;
    conversationPhaseRef.current = 'off';
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationLatestHeardText(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
  }, [abortSpeechInput, clearPendingConversationResult]);

  const startConversationListening = useCallback(async (sessionId?: string) => {
    if (!sessionId && !conversationSessionId) {
      return false;
    }

    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = false;
    conversationSubmittingRef.current = false;
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    await stopWorkingSoundAsync().catch(() => undefined);

    const started = await startSpeechInput({ continuous: true });
    if (!started) {
      conversationPhaseRef.current = 'off';
      setConversationPhase('off');
      return false;
    }

    conversationPhaseRef.current = 'listening';
    setConversationPhase('listening');
    return true;
  }, [clearPendingConversationResult, conversationSessionId, startSpeechInput]);

  const toggleConversationMode = useCallback(async () => {
    if (conversationPhase !== 'off') {
      await stopConversationMode();
      return;
    }

    if (connection.status !== 'connected') {
      setConversationFeedback('Connect to OpenCode before starting conversation mode.');
      return;
    }

    if (sendingState.active) {
      setConversationFeedback('Wait for the current reply to finish before starting conversation mode.');
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      setConversationFeedback('Answer the current request before starting conversation mode.');
      return;
    }

    const sessionId = currentSessionId || (await ensureActiveSession());
    if (!sessionId) {
      return;
    }

    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setCurrentSessionId(sessionId);
    setConversationSessionId(sessionId);
    setConversationFeedback(undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(sessionId)?.id;
    const started = await startConversationListening(sessionId);
    if (!started) {
      setConversationSessionId(undefined);
    }
  }, [
    abortSpeechInput,
    connection.status,
    conversationPhase,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    conversationPhaseRef.current = conversationPhase;
    if (conversationPhase !== 'submitting') {
      conversationSubmittingRef.current = false;
    }
  }, [conversationPhase]);

  useEffect(() => {
    if (conversationPhase !== 'listening' || isConversationListening || isConversationListeningStarting) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }

    if (conversationCancelRequestedRef.current || conversationSubmittingRef.current) {
      return;
    }

    conversationListeningRestartTimeoutRef.current = setTimeout(() => {
      conversationListeningRestartTimeoutRef.current = undefined;
      if (
        conversationPhaseRef.current !== 'listening' ||
        conversationCancelRequestedRef.current ||
        conversationSubmittingRef.current
      ) {
        return;
      }

      void startConversationListening();
    }, CONVERSATION_LISTENING_RESTART_MS);

    return () => {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
    };
  }, [conversationPhase, isConversationListening, isConversationListeningStarting, startConversationListening]);

  useConversationKeepAwake(conversationPhase, CONVERSATION_KEEP_AWAKE_TAG);
  useConversationScreenDim(conversationPhase);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    if (
      conversationPhaseRef.current === 'listening' &&
      (speechInputErrorCode === 'client' || speechInputErrorCode === 'no-speech' || speechInputErrorCode === 'speech-timeout')
    ) {
      return;
    }

    setConversationFeedback(speechInputError);
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [speechInputError, speechInputErrorCode, stopConversationMode]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'submitting' || !pendingConversationTurn || !conversationSessionId) {
      return;
    }

    setQueuedConversationPrompt(pendingConversationTurn);
    setPendingConversationTurn(undefined);
  }, [conversationPhase, conversationSessionId, pendingConversationTurn]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'submitting' || !queuedConversationPrompt || !conversationSessionId) {
      return;
    }

    let cancelled = false;

    const submitPrompt = async () => {
      try {
        assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(conversationSessionId)?.id;
        await sendPrompt(conversationSessionId, queuedConversationPrompt);
        if (cancelled) {
          return;
        }

        if (conversationCancelRequestedRef.current || conversationPhaseRef.current === 'off') {
          setQueuedConversationPrompt(undefined);
          setPendingConversationTurn(undefined);
          return;
        }

        setQueuedConversationPrompt(undefined);
        setConversationPhase('waiting');
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Voice conversation failed while sending your message.';
        setQueuedConversationPrompt(undefined);
        setPendingConversationTurn(undefined);
        setConversationFeedback(message);
        await stopConversationMode();
      }
    };

    void submitPrompt();

    return () => {
      cancelled = true;
    };
  }, [
    conversationPhase,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    queuedConversationPrompt,
    sendPrompt,
    stopConversationMode,
  ]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'waiting') {
      return;
    }

    const pendingInteractions = conversationSessionId
      ? (pendingPermissionsBySession[conversationSessionId] || []).length + (pendingQuestionsBySession[conversationSessionId] || []).length
      : 0;
    const latestAssistantEntry = getLatestConversationAssistantEntry(conversationSessionId);
    const sessionStatus = conversationSessionId ? sessionStatuses[conversationSessionId] : undefined;
    const isSessionRunning = conversationSessionId
      ? sendingState.sessionId === conversationSessionId || sendingState.active || (!!sessionStatus && sessionStatus.type !== 'idle')
      : false;

    if (pendingInteractions > 0) {
      setConversationFeedback('Conversation mode paused because the assistant needs your input on screen.');
      void stopConversationMode();
      return;
    }

    if (isSessionRunning) {
      return () => {
        void stopWorkingSoundAsync().catch(() => undefined);
      };
    }

    void stopWorkingSoundAsync().catch(() => undefined);
    if (latestAssistantEntry && latestAssistantEntry.id !== assistantReplyBaselineIdRef.current) {
      void (async () => {
        const started = await speakText({
          language: chatPreferences.speechLocale,
          onDone: () => {
            if (conversationPhaseRef.current !== 'off' && chatPreferences.resumeListeningAfterReply) {
              void startConversationListening();
            } else {
              void stopConversationMode();
            }
          },
          onError: () => {
            setConversationFeedback('Unable to play this assistant reply.');
            void stopConversationMode();
          },
          onStart: () => {
            setConversationPhase('speaking');
          },
          rate: chatPreferences.speechRate,
          text: latestAssistantEntry.text,
          voice: chatPreferences.speechVoiceId,
        });

        if (!started) {
          if (chatPreferences.resumeListeningAfterReply) {
            void startConversationListening();
          } else {
            void stopConversationMode();
          }
        }
      })();
      return;
    }

    conversationResumeTimeoutRef.current = setTimeout(() => {
      if (conversationPhaseRef.current === 'waiting' && !isSessionRunning) {
        void startConversationListening();
      }
    }, 1200);

    return () => {
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
        conversationResumeTimeoutRef.current = undefined;
      }
    };
  }, [
    chatPreferences.resumeListeningAfterReply,
    chatPreferences.speechLocale,
    chatPreferences.speechRate,
    chatPreferences.speechVoiceId,
    conversationPhase,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    sendingState.sessionId,
    sessionStatuses,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    if (conversationPhase === 'off' || connection.status === 'connected') {
      return;
    }

    setConversationFeedback(connection.message || 'OpenCode disconnected. Conversation mode will resume when the connection returns.');
  }, [connection.message, connection.status, conversationPhase]);

  useEffect(() => {
    if (connection.status !== 'connected') {
      return;
    }

    setConversationFeedback((current) => {
      if (!current) {
        return current;
      }

      if (current === connection.message || current.includes('resume when the connection returns')) {
        return undefined;
      }

      return current;
    });
  }, [connection.message, connection.status]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      setEventStreamStatus('idle');
      return;
    }

    let mounted = true;
    let activeAbortController: AbortController | undefined;

    const handleEvent = (event: GlobalEvent['payload']) => {
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
        case 'session.deleted':
          void refreshSessions(true);
          return;
        case 'session.status': {
          const sessionId = event.properties.sessionID;
          setSessionStatuses((current) => ({
            ...current,
            [sessionId]: event.properties.status,
          }));
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true });
          return;
        }
        case 'session.idle': {
          const sessionId = event.properties.sessionID;
          setSessionStatuses((current) => ({
            ...current,
            [sessionId]: { type: 'idle' },
          }));
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 50 });
          void refreshPendingInteractions();
          void refreshServerFeatures();
          return;
        }
        case 'session.error': {
          const sessionId = event.properties.sessionID;
          const error = event.properties.error;
          const message = error && 'data' in error && error.data && 'message' in error.data
            ? error.data.message
            : error && 'message' in error
              ? error.message
              : 'OpenCode could not complete the request.';
          setPromptError({
            message: error?.name ? `${error.name}: ${message}` : String(message),
            occurredAt: Date.now(),
            sessionId,
          });
          if (sessionId) {
            scheduleSessionRefresh(sessionId, { sessions: true, messages: true });
          }
          return;
        }
        case 'message.updated': {
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        }
        case 'message.part.updated':
        case 'message.part.removed': {
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        }
        case 'session.diff': {
          const sessionId = event.properties.sessionID;
          if (event.properties.diff.length > 0) {
            setDiffsBySession((current) => ({
              ...current,
              [sessionId]: event.properties.diff,
            }));
          } else {
            scheduleSessionRefresh(sessionId, { diff: true, delayMs: 50 });
          }
          return;
        }
        case 'todo.updated': {
          const sessionId = event.properties.sessionID;
          setTodosBySession((current) => ({
            ...current,
            [sessionId]: event.properties.todos,
          }));
          return;
        }
        case 'permission.asked': {
          const request = event.properties;
          setPendingPermissionsBySession((current) => ({
            ...current,
            [request.sessionID]: [
              ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
              request,
            ],
          }));
          return;
        }
        case 'permission.replied': {
          const { sessionID, requestID } = event.properties;
          setPendingPermissionsBySession((current) => ({
            ...current,
            [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
          }));
          return;
        }
        case 'question.asked': {
          const request = event.properties;
          setPendingQuestionsBySession((current) => ({
            ...current,
            [request.sessionID]: [
              ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
              request,
            ],
          }));
          return;
        }
        case 'question.replied':
        case 'question.rejected': {
          const { sessionID, requestID } = event.properties;
          setPendingQuestionsBySession((current) => ({
            ...current,
            [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
          }));
          return;
        }
        default:
          return;
      }
    };

    const subscribe = async () => {
      let retryDelay = 1000;
      while (mounted) {
        const abortController = new AbortController();
        activeAbortController = abortController;
        setEventStreamStatus(retryDelay === 1000 ? 'connecting' : 'error');

        try {
          const subscription = await catalogClient.global.event({ signal: abortController.signal });
          setEventStreamStatus('connected');
          retryDelay = 1000;
          for await (const envelope of subscription.stream) {
            if (!mounted || abortController.signal.aborted) {
              break;
            }
            if (envelope?.directory === activeProjectPath) {
              handleEvent(envelope.payload);
            }
          }
          if (mounted && !abortController.signal.aborted) {
            throw new Error('OpenCode event stream ended.');
          }
        } catch {
          if (!mounted || abortController.signal.aborted) {
            break;
          }
          setEventStreamStatus('error');
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 15000);
        }
      }
    };

    void subscribe();

    return () => {
      mounted = false;
      activeAbortController?.abort();
    };
  }, [activeProjectPath, catalogClient, connection.status, refreshPendingInteractions, refreshServerFeatures, refreshSessions, scheduleSessionRefresh]);

  useEffect(
    () => () => {
      Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      sessionRefreshTimeoutsRef.current = {};
      sessionRefreshOptionsRef.current = {};
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
      }
      if (conversationFinalResultTimeoutRef.current) {
        clearTimeout(conversationFinalResultTimeoutRef.current);
      }

      void stopSpeaking().catch(() => undefined);
      void unloadWorkingSoundAsync().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    const hasBusySession = Object.values(sessionStatuses).some((status) => status.type !== 'idle');
    const hasConversationActivity = conversationPhase !== 'off';
    const useSafetyPolling = eventStreamStatus !== 'connected';
    const shouldKeepSafetyPoll = useSafetyPolling || hasBusySession || sendingState.active || hasConversationActivity;

    if (!shouldKeepSafetyPoll) {
      return;
    }

    const interval = setInterval(() => {
      const currentHasBusySession = Object.values(sessionStatuses).some((status) => status.type !== 'idle');
      const currentHasConversationActivity = conversationPhase !== 'off';

      if (currentHasBusySession || sendingState.active || useSafetyPolling) {
        void refreshSessions(true);
        void refreshPendingInteractions();
      }

      if (currentSessionId && (currentHasBusySession || sendingState.active)) {
        void Promise.all([
          refreshMessages(currentSessionId, true),
          refreshSessionDiff(currentSessionId, true),
          refreshSessionTodos(currentSessionId),
        ]);
      }

      if (conversationSessionId && conversationSessionId !== currentSessionId && (currentHasConversationActivity || currentHasBusySession || sendingState.active)) {
        void Promise.all([
          refreshMessages(conversationSessionId, true),
          refreshSessionDiff(conversationSessionId, true),
          refreshSessionTodos(conversationSessionId),
        ]);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, conversationPhase, conversationSessionId, currentSessionId, eventStreamStatus, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshSessions, sendingState.active, sessionStatuses]);

  useEffect(() => {
    const busy = sendingState.active || Object.values(sessionStatuses).some((status) => status.type !== 'idle');
    const shouldPlay = Platform.OS !== 'web' && chatPreferences.workingSoundEnabled && busy && conversationPhase !== 'listening' && conversationPhase !== 'speaking';
    if (shouldPlay) {
      void startWorkingSoundAsync(chatPreferences.workingSoundVariant, chatPreferences.workingSoundVolume).catch(() => undefined);
      return;
    }
    void stopWorkingSoundAsync().catch(() => undefined);
  }, [chatPreferences.workingSoundEnabled, chatPreferences.workingSoundVariant, chatPreferences.workingSoundVolume, conversationPhase, sendingState.active, sessionStatuses]);

  useEffect(() => {
    let cancelled = false;

    async function flushCompletedNotifications() {
      const pendingIds = [...pendingNotificationSessionIdsRef.current];
      if (pendingIds.length === 0) {
        return;
      }

      for (const sessionId of pendingIds) {
        const status = sessionStatuses[sessionId];
        if ((status && status.type !== 'idle') || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        pendingNotificationSessionIdsRef.current.delete(sessionId);
        await clearPendingTaskFinishedNotification(sessionId);
        if (cancelled) {
          return;
        }

        const session = sessions.find((item) => item.id === sessionId);
        const title = session?.title || 'Task complete';
        await notifyTaskFinished('OpenCode finished a task', title);
      }
    }

    void flushCompletedNotifications();

    return () => {
      cancelled = true;
    };
  }, [sendingState.active, sendingState.sessionId, sessionStatuses, sessions]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    if (patch.serverUrl !== undefined && patch.serverUrl !== settingsRef.current.serverUrl) {
      setPendingPermissionsBySession({});
      setPendingQuestionsBySession({});
    }
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, []);
  const clearPromptError = useCallback(() => setPromptError(undefined), []);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    if (sessions.some((session) => session.id === currentSessionId)) {
      return;
    }

    const rememberedSessionId = activeProjectPath ? lastSessionByProject[activeProjectPath] : undefined;
    const fallbackSessionId = sessions.find((session) => session.id === rememberedSessionId)?.id || sessions[0]?.id;
    setCurrentSessionId(fallbackSessionId);
  }, [activeProjectPath, currentSessionId, lastSessionByProject, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => (currentSessionId ? messagesBySession[currentSessionId] || [] : []),
    [currentSessionId, messagesBySession],
  );
  const currentDiffs = useMemo(
    () => (currentSessionId ? diffsBySession[currentSessionId] || [] : []),
    [currentSessionId, diffsBySession],
  );
  const currentTodos = useMemo(
    () => (currentSessionId ? todosBySession[currentSessionId] || [] : []),
    [currentSessionId, todosBySession],
  );
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession),
    [currentSessionId, pendingPermissionsBySession, sendingState.sessionId],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession),
    [currentSessionId, pendingQuestionsBySession, sendingState.sessionId],
  );
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const currentTranscript = useMemo(() => getTranscript(currentMessages), [currentMessages]);
  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => getTranscript(conversationMessages), [conversationMessages]);
  const conversationCurrentActivityLabel = useMemo(() => getTranscriptActivityLabelForEntries(conversationTranscript), [conversationTranscript]);
  const conversationActive = conversationPhase !== 'off';
  const conversationStatusLabel = useMemo(() => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel), [conversationCurrentActivityLabel, conversationPhase]);
  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);

  const contextValue = useMemo<OpencodeContextValue>(
    () => ({
      isHydrated,
      settings,
      updateSettings,
      connection,
      projects,
      activeProjectPath,
      activeProject,
      selectProject,
      serverProjects,
      currentProjectPath,
      serverRootPath,
      isRefreshingWorkspaceCatalog,
      refreshWorkspaceCatalog,
      refreshWorkspaceStatus: refreshServerFeatures,
      sessions,
      sessionStatuses,
      currentSessionId,
      activeSession,
      currentMessages,
      currentDiffs,
      currentTranscript,
      currentTodos,
      currentPendingPermissions,
      currentPendingQuestions,
      sessionPreviewById,
      isRefreshingSessions,
      isRefreshingMessages,
      isRefreshingDiffs,
      isBootstrappingChat,
      currentConfig,
      availableProviders,
      providerAuthMethodsById,
      configuredProviders,
      availableModels,
      availableAgents,
      chatPreferences,
      updateChatPreferences,
      conversation: {
        active: conversationActive,
        feedback: conversationFeedback,
        isListening: isConversationListening,
        level: conversationListeningLevel,
        latestHeardText: conversationLatestHeardText,
        phase: conversationPhase,
        sessionId: conversationSessionId,
        statusLabel: conversationStatusLabel,
      },
      clearConversationFeedback,
      toggleConversationMode,
      configureProvider,
      setProviderAuth,
      startProviderOAuth,
      completeProviderOAuth,
      setAutoApprove,
      sendingState,
      promptError,
      clearPromptError,
      connect,
      refreshSessions,
      openSession,
      refreshCurrentSession,
      refreshCurrentTodos,
      ensureActiveSession,
      createSession,
      deleteSession,
      renameSession,
      forkSession,
      shareSession,
      unshareSession,
      revertSession,
      unrevertSession,
      sendPrompt,
      abortSession,
      replyToPermission,
      replyToQuestion,
      rejectQuestion,
      commands,
      executeCommand,
      workspaceFiles,
      workspaceFileStatuses,
      selectedWorkspaceFile,
      vcsInfo,
      searchWorkspaceFiles,
      openWorkspaceFile,
      diagnostics,
      refreshDiagnostics,
      eventStreamStatus,
    }),
    [
      activeSession,
      activeProject,
      activeProjectPath,
      connect,
      connection,
      currentConfig,
      availableProviders,
      providerAuthMethodsById,
      configuredProviders,
      currentDiffs,
      createSession,
      deleteSession,
      renameSession,
      forkSession,
      shareSession,
      unshareSession,
      revertSession,
      unrevertSession,
      configureProvider,
      currentMessages,
      currentSessionId,
      currentTranscript,
      currentTodos,
      currentPendingPermissions,
      currentPendingQuestions,
      chatPreferences,
      clearConversationFeedback,
      clearPromptError,
      conversationActive,
      conversationFeedback,
      conversationLatestHeardText,
      conversationListeningLevel,
      conversationPhase,
      conversationSessionId,
      conversationStatusLabel,
      ensureActiveSession,
      availableAgents,
      availableModels,
      isConversationListening,
      isBootstrappingChat,
      isRefreshingDiffs,
      isHydrated,
      isRefreshingMessages,
      isRefreshingWorkspaceCatalog,
      isRefreshingSessions,
      openSession,
      promptError,
      currentProjectPath,
      projects,
      refreshCurrentSession,
      refreshCurrentTodos,
      refreshWorkspaceCatalog,
      refreshServerFeatures,
      refreshSessions,
      replyToPermission,
      replyToQuestion,
      rejectQuestion,
      selectProject,
      setAutoApprove,
      sendPrompt,
      abortSession,
      sendingState,
      serverRootPath,
      sessionPreviewById,
      sessionStatuses,
      sessions,
      serverProjects,
      settings,
      setProviderAuth,
      startProviderOAuth,
      completeProviderOAuth,
      toggleConversationMode,
      updateChatPreferences,
      updateSettings,
      commands,
      executeCommand,
      workspaceFiles,
      workspaceFileStatuses,
      selectedWorkspaceFile,
      vcsInfo,
      searchWorkspaceFiles,
      openWorkspaceFile,
      diagnostics,
      refreshDiagnostics,
      eventStreamStatus,
    ],
  );

  return <OpencodeContext.Provider value={contextValue}>{children}</OpencodeContext.Provider>;
}

export function useOpencode() {
  const context = useContext(OpencodeContext);
  if (!context) {
    throw new Error('useOpencode must be used inside OpencodeProvider');
  }

  return context;
}
