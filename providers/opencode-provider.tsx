import type { FilePartInput, GlobalEvent, TextPartInput } from '@opencode-ai/sdk/v2/client';
import type {
  Command,
  Config,
  File,
  FileContent,
  FileDiff,
  GlobalSession,
  Project,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from '@/lib/opencode/types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';

import {
  buildClient,
  defaultConnectionSettings,
  detectServerContract,
  getConnectionError,
  getNormalizedServerUrl,
  isContractMismatchError,
  isValidServerUrl,
  listPendingInteractions,
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  type PendingPermissionRequest,
  type PendingQuestionAnswer,
  type PendingQuestionRequest,
  type OpencodeConnectionSettings,
  type ServerContract,
  type ScopedOpencodeClient,
} from '@/lib/opencode/client';
import {
  deriveTodosFromMessages,
  mergeSessionMessageRecords,
  toTranscriptEntry,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { aggregateSessionUsage, getLatestAssistantTurnUsage } from '@/lib/opencode/usage';
import { createFullFilePatch } from '@/lib/opencode/workspace-patch';
import {
  findMatchingProfile,
  findProfileByConnectionScope,
  getProfilePassword,
  loadConnectionProfiles,
  pickModelPreferences,
  saveConnectionProfiles,
} from '@/lib/connection-profiles';
import { getConnectionScope } from '@/lib/connection-scope';
import { changeAppLanguage } from '@/lib/i18n';
import { pendingNotificationKey } from '@/lib/notification-pending';
import {
  clearPendingTaskFinishedNotification,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
} from '@/lib/notifications';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import {
  startWorkingSoundAsync,
  stopWorkingSoundAsync,
  unloadWorkingSoundAsync,
} from '@/lib/voice/working-sound';
import { getServerCapabilities, isAutoApproveEnabled, mergePermissionConfig } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  getSelectedModelParts,
  recordRecentModelId,
} from '@/providers/opencode-model-selection';
import { buildSystemPrompt, defaultChatPreferences } from '@/providers/opencode-preferences';
import { getProjectLabel, groupPendingRequestsBySession } from '@/providers/opencode-provider-utils';
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
  FAVORITE_SESSIONS_MAX,
  type AgentOption,
  type CapabilitiesContextValue,
  type ChatContextValue,
  type ChatPreferences,
  type ConnectionContextValue,
  type ConnectionState,
  type ConversationContextValue,
  type ConversationPhase,
  type ConversationState,
  type DiffScope,
  type DiffTurn,
  type FavoriteSession,
  type McpContextValue,
  type ModelOption,
  type OnboardingContextValue,
  type OpencodeProject,
  type PreferencesContextValue,
  type ProviderAuthMethod,
  type ProviderOption,
  type SessionContextValue,
  type SessionDeepLinkTarget,
  type TerminalContextValue,
  type WorkspaceCatalog,
  type WorkspaceContextValue,
} from '@/providers/opencode-provider-types';
import {
  CapabilitiesContext,
  ChatContext,
  ConnectionContext,
  ConversationContext,
  McpContext,
  OnboardingContext,
  PreferencesContext,
  SessionContext,
  TerminalContext,
  WorkspaceContext,
} from '@/providers/opencode-contexts';
import { hydrateSessionCache, persistSessionCache } from '@/providers/session-cache';
import {
  CURRENT_ONBOARDING_VERSION,
  isOnboardingComplete,
} from '@/providers/onboarding-state';
import { useConversationKeepAwake } from '@/providers/use-conversation-keep-awake';
import { useConversationScreenDim } from '@/providers/use-conversation-screen-dim';
import { useMcpState } from '@/providers/use-mcp-state';
import { useOpencodePersistence } from '@/providers/use-opencode-persistence';
import { useTerminalState } from '@/providers/use-terminal-state';
import { useWorktreeState } from '@/providers/use-worktree-state';
import {
  loadWorkspaceCatalog as svcLoadWorkspaceCatalog,
  archiveSession as svcArchiveSession,
  listArchivedSessions as svcListArchivedSessions,
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
  restoreSession as svcRestoreSession,
  resolveWorkspace as svcResolveWorkspace,
} from '@/providers/services/session-service';
import { loadDiagnostics, type Diagnostics } from '@/providers/services/diagnostics-service';
import {
  applyVcsPatch,
  findFiles,
  getFileStatus,
  getVcsDiff as svcGetVcsDiff,
  getVcsInfo,
  readFile,
} from '@/providers/services/workspace-service';

export type {
  AgentOption,
  ChatPreferences,
  ConnectionState,
  ConversationPhase,
  ConversationState,
  DiffScope,
  DiffTurn,
  FavoriteSession,
  ModelOption,
  OpencodeContextValue,
  OpencodeProject,
  ProviderAuthMethod,
  ProviderOption,
  ReasoningLevel,
  ResponseScope,
} from '@/providers/opencode-provider-types';

// Foreground notification tracking for prompts sent in this app session. Keyed
// by connection scope + session ID so switching servers cannot complete or
// clear another server's pending task.
// Conversation feedback and its optional recovery action are always written
// together so a stale action can never outlive the message it belongs to.
function applyConversationFeedback(
  setFeedback: (value: string | undefined) => void,
  setAction: (value: VoiceRecoveryAction) => void,
  message: string | undefined,
  action: VoiceRecoveryAction = 'none',
) {
  setFeedback(message);
  setAction(action);
}

type TrackedPendingNotification = {
  sessionId: string;
  connectionScope: string;
  requestedAt: number;
};

export function OpencodeProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<OpencodeConnectionSettings>(defaultConnectionSettings);
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'idle',
    message: 'Add a server URL and connect to OpenCode.',
  });
  const [serverContract, setServerContract] = useState<ServerContract>('v1');
  const [activeProjectPath, setActiveProjectPath] = useState<string>();
  // Completion-only onboarding marker: 0 means started/not completed, and
  // CURRENT_ONBOARDING_VERSION means done. Never holds configuration.
  const [onboardingVersion, setOnboardingVersion] = useState(0);
  // Review mode launched from Settings. It keeps the tab navigator mounted so
  // re-running the assistant cannot drop the current configuration or session.
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<GlobalSession[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, SessionMessageRecord[]>>({});
  const [diffsBySession, setDiffsBySession] = useState<Record<string, FileDiff[]>>({});
  const [vcsDiffsByScope, setVcsDiffsByScope] = useState<Record<'uncommitted' | 'branch', FileDiff[]>>({ uncommitted: [], branch: [] });
  const [diffScopeBySession, setDiffScopeBySession] = useState<Record<string, DiffScope>>({});
  const [selectedDiffMessageBySession, setSelectedDiffMessageBySession] = useState<Record<string, string | undefined>>({});
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
  const pendingNotificationsRef = useRef<Map<string, TrackedPendingNotification>>(new Map());
  const busyNotificationsRef = useRef<Set<string>>(new Set());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  const [currentConfig, setCurrentConfig] = useState<Config>();
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [providerAuthMethodsById, setProviderAuthMethodsById] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  // Remembered session per connection scope, then per project path. Two servers
  // exposing the same path keep independent entries.
  const [lastSessionByConnection, setLastSessionByConnection] = useState<Record<string, Record<string, string>>>({});
  const [favoriteSessions, setFavoriteSessions] = useState<FavoriteSession[]>([]);
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>('off');
  const [conversationSessionId, setConversationSessionId] = useState<string>();
  const [queuedConversationPrompt, setQueuedConversationPrompt] = useState<string>();
  const [pendingConversationTurn, setPendingConversationTurn] = useState<string>();
  const [conversationFeedback, setConversationFeedback] = useState<string>();
  const [conversationFeedbackAction, setConversationFeedbackAction] = useState<VoiceRecoveryAction>('none');
  const [conversationLatestHeardText, setConversationLatestHeardText] = useState<string>();
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [commands, setCommands] = useState<Command[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceFileStatuses, setWorkspaceFileStatuses] = useState<File[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<{ path: string; content: FileContent }>();
  const [vcsInfo, setVcsInfo] = useState<VcsInfo>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();

  // Stable, password-free identity for the configured server + user. Every
  // piece of server-derived persisted state (session caches, last session,
  // favorites, pending notifications) is scoped by it.
  const connectionScope = useMemo(
    () => getConnectionScope({ serverUrl: settings.serverUrl, username: settings.username }),
    [settings.serverUrl, settings.username],
  );

  const settingsRef = useRef(settings);
  const chatPreferencesRef = useRef(chatPreferences);
  const connectionScopeRef = useRef(connectionScope);
  const activeProjectPathRef = useRef(activeProjectPath);
  const connectionRef = useRef(connection);
  const serverContractRef = useRef<ServerContract>('v1');
  serverContractRef.current = serverContract;
  const serverProjectsRef = useRef<Project[]>([]);
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const pendingDeepLinkTargetRef = useRef<SessionDeepLinkTarget | undefined>(undefined);
  const deepLinkOperationRef = useRef<object | undefined>(undefined);
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const catalogGenerationRef = useRef(new WeakMap<object, number>());
  const initialConnectStartedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const bootstrapTokenRef = useRef<object | undefined>(undefined);
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
  const diffScopeBySessionRef = useRef<Record<string, DiffScope>>({});
  const selectedDiffMessageBySessionRef = useRef<Record<string, string | undefined>>({});
  // Latest-ref holders for callbacks that are defined after the domain hooks
  // below. The hooks only read them from event handlers, never during render.
  const refreshWorkspaceCatalogRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const refreshChatCapabilitiesRef = useRef<() => Promise<void>>(async () => undefined);
  settingsRef.current = settings;
  chatPreferencesRef.current = chatPreferences;
  connectionScopeRef.current = connectionScope;
  activeProjectPathRef.current = activeProjectPath;
  connectionRef.current = connection;
  currentSessionIdRef.current = currentSessionId;
  diffScopeBySessionRef.current = diffScopeBySession;
  selectedDiffMessageBySessionRef.current = selectedDiffMessageBySession;

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
    favoriteSessions,
    lastSessionByConnection,
    onboardingVersion,
    setActiveProjectPath,
    setChatPreferences,
    setFavoriteSessions,
    setLastSessionByConnection,
    setOnboardingVersion,
    setSettings,
    settings,
  });

  const onboardingCompleted = isOnboardingComplete(onboardingVersion);

  const completeOnboarding = useCallback(async () => {
    setOnboardingVersion(CURRENT_ONBOARDING_VERSION);
    setOnboardingActive(false);
  }, []);

  const startOnboardingReview = useCallback(() => {
    setOnboardingActive(true);
  }, []);

  const stopOnboardingReview = useCallback(() => {
    setOnboardingActive(false);
  }, []);

  // Apply the persisted UI language once hydration finishes, and again whenever
  // the preference changes. An undefined preference follows the OS locale.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    changeAppLanguage(chatPreferences.language);
  }, [chatPreferences.language, isHydrated]);

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
    () => buildClient({ ...settings, directory: activeProjectPath || '' }, serverContract),
    [activeProjectPath, serverContract, settings],
  );
  const catalogClient = useMemo(() => buildClient({ ...settings, directory: '' }, serverContract), [serverContract, settings]);
  if (!clientGenerationRef.current.has(client)) {
    clientGenerationRef.current.set(client, scopeGenerationRef.current);
  }
  if (!catalogGenerationRef.current.has(catalogClient)) {
    catalogGenerationRef.current.set(catalogClient, serverGenerationRef.current);
  }
  const isCurrentClient = useCallback(
    (candidate: object) => clientGenerationRef.current.get(candidate) === scopeGenerationRef.current,
    [],
  );
  const isCurrentCatalogClient = useCallback(
    (candidate: object) => catalogGenerationRef.current.get(candidate) === serverGenerationRef.current,
    [],
  );

  const {
    terminals,
    terminalShells,
    activeTerminalId,
    terminalOutput,
    terminalConnection,
    refreshTerminals,
    openTerminal,
    createTerminal,
    sendTerminalInput,
    closeTerminal,
    resetTerminal,
  } = useTerminalState({
    client,
    directory: activeProjectPath || '',
    isCurrentClient,
    serverContract,
    serverUrl: settings.serverUrl,
  });

  const {
    worktrees,
    refreshWorktrees,
    createWorktree,
    resetWorktree,
    removeWorktree,
    resetWorktrees,
  } = useWorktreeState({
    client,
    isCurrentClient,
    refreshWorkspaceCatalog: (silent) => refreshWorkspaceCatalogRef.current(silent),
  });

  const {
    mcpStatuses,
    refreshMcpServers,
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    setMcpServerEnabled,
    startMcpOAuth,
    completeMcpOAuth,
    resetMcpState,
  } = useMcpState({
    client,
    isCurrentClient,
    refreshChatCapabilities: () => refreshChatCapabilitiesRef.current(),
  });

  const clearProjectState = useCallback(() => {
    bootstrapPromiseRef.current = null;
    bootstrapTokenRef.current = undefined;
    pendingNotificationsRef.current.clear();
    busyNotificationsRef.current.clear();
    // Cancel pending session refresh timers. Without this, timeouts scheduled
    // for sessions in the previous project keep firing after a project switch,
    // running refresh callbacks that capture stale client instances and write
    // into state slices that were just cleared above.
    Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    sessionRefreshTimeoutsRef.current = {};
    sessionRefreshOptionsRef.current = {};
    setCurrentSessionId(undefined);
    setSessions([]);
    setArchivedSessions([]);
    setSessionStatuses({});
    setCommands([]);
    setCurrentConfig(undefined);
    setAvailableProviders([]);
    setProviderAuthMethodsById({});
    setAvailableModels([]);
    setAvailableAgents([]);
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setWorkspaceFiles([]);
    setWorkspaceFileStatuses([]);
    setSelectedWorkspaceFile(undefined);
    setVcsInfo(undefined);
    resetMcpState();
    resetTerminal();
    resetWorktrees();
  }, [resetMcpState, resetTerminal, resetWorktrees]);

  // browseServerPath stub removed

  const loadWorkspaceCatalog = useCallback(
    async (silent = false, targetClient: ScopedOpencodeClient = catalogClient): Promise<WorkspaceCatalog> => {
      if (!silent) {
        setIsRefreshingWorkspaceCatalog(true);
      }

      try {
        const result = await svcLoadWorkspaceCatalog(targetClient);
        if (!isCurrentCatalogClient(targetClient)) {
          return result;
        }
        const nextServerProjects = result.serverProjects as Project[];
        serverProjectsRef.current = nextServerProjects;
        setServerProjects(nextServerProjects);
        setCurrentProjectPath(result.currentProjectPath);
        setServerRootPath(result.serverRootPath);
        const currentProject = activeProjectPathRef.current;
        const nextProject = currentProject && result.serverProjects.some((project) => project.worktree === currentProject)
          ? currentProject
          : result.currentProjectPath || result.serverProjects[0]?.worktree;
        if (nextProject !== currentProject) {
          scopeGenerationRef.current += 1;
          clearProjectState();
          setActiveProjectPath(nextProject);
        }
        return result;
      } finally {
        if (!silent) {
          setIsRefreshingWorkspaceCatalog(false);
        }
      }
    },
    [catalogClient, clearProjectState, isCurrentCatalogClient],
  );

  const refreshWorkspaceCatalog = useCallback(
    async (silent = false) => {
      await loadWorkspaceCatalog(silent);
    },
    [loadWorkspaceCatalog],
  );
  refreshWorkspaceCatalogRef.current = refreshWorkspaceCatalog;

  // Paint the cached session list for the active project on boot and on every
  // project switch; the regular refresh reconciles once the server answers.
  // fetchSessions is the only writer, so a cached empty list always means the
  // server confirmed that project has no sessions.
  const sessionCacheKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const projectPath = activeProjectPath;
    const scope = connectionScope;
    const cacheKey = projectPath ? `${scope}\u0000${projectPath}` : undefined;
    if (sessionCacheKeyRef.current === cacheKey) {
      return;
    }
    sessionCacheKeyRef.current = cacheKey;
    if (!projectPath) {
      return;
    }
    void hydrateSessionCache(
      scope,
      projectPath,
      (cached) => setSessions(cached),
      (cached) => setSessionStatuses(cached as Record<string, SessionStatus>),
      // A late read from the previous connection or project must never land in
      // the new connection's state, even when both expose the same path.
      () => activeProjectPathRef.current === projectPath && connectionScopeRef.current === scope,
    );
  }, [activeProjectPath, connectionScope, isHydrated]);

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
        if (!isCurrentClient(client)) {
          return result.sessions;
        }
        setSessions(result.sessions);
        setSessionStatuses(result.statuses);
        void persistSessionCache(connectionScope, activeProjectPath, result.sessions, result.statuses);
        return result.sessions;
      } finally {
        if (!silent) {
          setIsRefreshingSessions(false);
        }
      }
    },
    [activeProjectPath, client, connectionScope, isCurrentClient],
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
        if (!isCurrentClient(client)) {
          return data;
        }
        setMessagesBySession((current) => {
          const previous = current[sessionId] ?? [];
          const merged = mergeSessionMessageRecords(previous, data);
          // Returning the same state reference when nothing changed lets React
          // skip the re-render that downstream useMemos key off this array for.
          if (merged === previous) {
            return current;
          }
          return { ...current, [sessionId]: merged };
        });

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false, messageId?: string) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const targetMessageId = messageId ?? selectedDiffMessageBySessionRef.current[sessionId];
        const data = await svcGetSessionDiff(client, sessionId, targetMessageId);
        if (!isCurrentClient(client)) {
          return data;
        }
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
    [client, isCurrentClient],
  );

  const refreshVcsDiff = useCallback(
    async (scope: 'uncommitted' | 'branch', silent = false) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const data = await svcGetVcsDiff(client, scope === 'branch' ? 'branch' : 'git');
        if (!isCurrentClient(client)) {
          return data;
        }
        setVcsDiffsByScope((current) => ({
          ...current,
          [scope]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const setDiffScope = useCallback(
    (scope: DiffScope) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setDiffScopeBySession((current) => ({ ...current, [sessionId]: scope }));
      if (scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [refreshVcsDiff],
  );

  const selectDiffMessage = useCallback(
    (messageId: string) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: messageId }));
      void refreshSessionDiff(sessionId, true, messageId);
    },
    [refreshSessionDiff],
  );

  const refreshDiffs = useCallback(
    async (silent = false) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const scope = diffScopeBySessionRef.current[sessionId] ?? 'turn';
      if (scope === 'turn') {
        await refreshSessionDiff(sessionId, silent);
      } else {
        await refreshVcsDiff(scope, silent);
      }
    },
    [refreshSessionDiff, refreshVcsDiff],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);
      if (!isCurrentClient(client)) {
        return data;
      }

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client, isCurrentClient],
  );

  const refreshPendingInteractions = useCallback(async () => {
    const { permissions, questions } = await listPendingInteractions(client);
    if (!isCurrentClient(client)) {
      return;
    }
    setPendingPermissionsBySession(groupPendingRequestsBySession(permissions));
    setPendingQuestionsBySession(groupPendingRequestsBySession(questions));
  }, [client, isCurrentClient]);

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
    if (!isCurrentClient(client)) {
      return;
    }

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
  }, [activeProjectPath, client, isCurrentClient]);
  refreshChatCapabilitiesRef.current = refreshChatCapabilities;

  const openSession = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      if (activeProjectPath) {
        const scope = connectionScopeRef.current;
        setLastSessionByConnection((current) => ({
          ...current,
          [scope]: {
            ...current[scope],
            [activeProjectPath]: sessionId,
          },
        }));
      }
      await Promise.all([refreshMessages(sessionId), refreshSessionDiff(sessionId, true), refreshSessionTodos(sessionId), refreshPendingInteractions()]);
      const scope = diffScopeBySessionRef.current[sessionId];
      if (scope && scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [activeProjectPath, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshVcsDiff],
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
      if (!isCurrentClient(client)) {
        throw new Error('The active project changed before the session was created.');
      }
      await refreshSessions(true);
      return response.data;
    },
    [client, isCurrentClient, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await svcDeleteSession(client, sessionId);
      if (!isCurrentClient(client)) {
        return;
      }
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
      // Removing the session invalidates any favorite for it on this
      // connection; an identical session ID on another server is unrelated.
      setFavoriteSessions((current) => current.filter(
        (favorite) => !(favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId),
      ));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(undefined);
      }
      await refreshSessions(true);
    },
    [client, currentSessionId, isCurrentClient, refreshSessions],
  );

  const refreshArchivedSessions = useCallback(async () => {
    const next = await svcListArchivedSessions(client);
    if (isCurrentClient(client)) {
      setArchivedSessions([...next].sort((left, right) => right.time.updated - left.time.updated));
    }
  }, [client, isCurrentClient]);

  const archiveSession = useCallback(async (sessionId: string) => {
    await svcArchiveSession(client, sessionId);
    if (!isCurrentClient(client)) return;
    if (currentSessionId === sessionId) setCurrentSessionId(undefined);
    await Promise.all([refreshSessions(true), refreshArchivedSessions()]);
  }, [client, currentSessionId, isCurrentClient, refreshArchivedSessions, refreshSessions]);

  // Favorites always belong to the active connection; the scope is derived
  // from the current settings instead of being passed in by the UI.
  const toggleFavoriteSession = useCallback((sessionId: string, projectPath: string, title?: string) => {
    const trimmedSessionId = sessionId.trim();
    const trimmedPath = projectPath.trim();
    if (!trimmedSessionId || !trimmedPath) {
      return;
    }
    const scope = connectionScopeRef.current;
    setFavoriteSessions((current) => {
      if (current.some((favorite) => favorite.connectionScope === scope && favorite.sessionId === trimmedSessionId)) {
        return current.filter((favorite) => !(favorite.connectionScope === scope && favorite.sessionId === trimmedSessionId));
      }
      const trimmedTitle = title?.trim();
      const next = [
        {
          sessionId: trimmedSessionId,
          connectionScope: scope,
          projectPath: trimmedPath,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
          favoritedAt: Date.now(),
        },
        ...current,
      ];
      // New entries prepend, so the oldest favorites sit at the tail.
      return next.length > FAVORITE_SESSIONS_MAX ? next.slice(0, FAVORITE_SESSIONS_MAX) : next;
    });
  }, []);

  const isFavoriteSession = useCallback(
    (sessionId: string) => favoriteSessions.some(
      (favorite) => favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId,
    ),
    [favoriteSessions],
  );

  const clearFavoriteSession = useCallback((sessionId: string) => {
    setFavoriteSessions((current) => current.filter(
      (favorite) => !(favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId),
    ));
  }, []);


  const restoreSession = useCallback(async (sessionId: string) => {
    await svcRestoreSession(client, sessionId);
    if (!isCurrentClient(client)) return;
    await Promise.all([refreshSessions(true), refreshArchivedSessions()]);
  }, [client, isCurrentClient, refreshArchivedSessions, refreshSessions]);

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
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before the session was forked.');
    }
    await refreshSessions(true);
    await openSession(forked.id);
    return forked;
  }, [client, isCurrentClient, openSession, refreshSessions]);

  const shareSession = useCallback(async (sessionId: string) => {
    const shared = await svcShareSession(client, sessionId);
    if (!shared) {
      throw new Error('OpenCode did not return the shared session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before sharing finished.');
    }
    await refreshSessions(true);
    return shared;
  }, [client, isCurrentClient, refreshSessions]);

  const unshareSession = useCallback(async (sessionId: string) => {
    const unshared = await svcUnshareSession(client, sessionId);
    if (!unshared) {
      throw new Error('OpenCode did not return the session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before unsharing finished.');
    }
    await refreshSessions(true);
    return unshared;
  }, [client, isCurrentClient, refreshSessions]);

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
    if (!isCurrentClient(client)) {
      return;
    }
    setCommands(nextCommands || []);
    setWorkspaceFileStatuses(nextStatuses || []);
    setVcsInfo(nextVcs);
  }, [activeProjectPath, client, isCurrentClient]);

  const refreshDiagnostics = useCallback(async () => {
    const nextDiagnostics = await loadDiagnostics(client);
    if (isCurrentClient(client)) {
      setDiagnostics(nextDiagnostics);
    }
  }, [client, isCurrentClient]);

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
    if (content.type === 'binary' || content.encoding === 'base64') {
      throw new Error('Binary files cannot be previewed as text.');
    }
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setSelectedWorkspaceFile({ path, content });
    }
  }, [client]);

  const saveWorkspaceFile = useCallback(async (path: string, expectedContent: string, content: string) => {
    const latest = await readFile(client, path);
    if (latest.type !== 'text' || latest.encoding === 'base64') throw new Error('Only text files can be edited.');
    if (latest.content !== expectedContent) throw new Error('The file changed on the server. Reopen it before saving.');
    const patch = createFullFilePatch({ path, expectedContent, content });
    if (!patch) return;
    await applyVcsPatch(client, patch);
    const saved = await readFile(client, path);
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setSelectedWorkspaceFile({ path, content: saved });
      await refreshServerFeatures();
      // Keep an active VCS diff scope honest after a manual edit.
      const activeSessionId = currentSessionIdRef.current;
      const scope = activeSessionId ? diffScopeBySessionRef.current[activeSessionId] : undefined;
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, refreshServerFeatures, refreshVcsDiff]);

  const executeCommand = useCallback(async (sessionId: string, command: string, args: string) => {
    const selected = getSelectedModelParts(chatPreferences.modelId);
    await svcExecuteCommand(client, sessionId, command, args, {
      agent: chatPreferences.mode,
      model: selected ? `${selected.providerID}/${selected.modelID}` : undefined,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]).catch(() => undefined);
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

    const pendingTarget = pendingDeepLinkTargetRef.current;
    if (
      currentSessionId &&
      sessions.some((session) => session.id === currentSessionId) &&
      (!pendingTarget || pendingTarget.sessionId === currentSessionId)
    ) {
      if (!messagesBySession[currentSessionId]) {
        await refreshMessages(currentSessionId, true);
      }
      return currentSessionId;
    }

    if (bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapToken = {};
    bootstrapTokenRef.current = bootstrapToken;
    const bootstrapPromise = (async () => {
      setIsBootstrappingChat(true);

      try {
        const nextSessions = sessions.length > 0 ? sessions : await fetchSessions(true);
        if (pendingDeepLinkTargetRef.current !== pendingTarget) {
          return undefined;
        }
        const rememberedSessionId = activeProjectPath
          ? lastSessionByConnection[connectionScope]?.[activeProjectPath]
          : undefined;
        const targetSession = pendingTarget
          ? nextSessions.find((session) => session.id === pendingTarget.sessionId)
          : (rememberedSessionId ? nextSessions.find((session) => session.id === rememberedSessionId) : undefined) ??
            nextSessions[0] ??
            (await createSession());
        if (!targetSession) {
          return undefined;
        }
        await Promise.all([
          refreshMessages(targetSession.id, true),
          refreshSessionDiff(targetSession.id, true),
          refreshSessionTodos(targetSession.id),
          refreshPendingInteractions(),
          refreshChatCapabilities(),
          refreshServerFeatures(),
          refreshDiagnostics(),
        ]);
        if (!isCurrentClient(client) || pendingDeepLinkTargetRef.current !== pendingTarget) {
          return undefined;
        }
        setCurrentSessionId(targetSession.id);
        if (activeProjectPath) {
          setLastSessionByConnection((current) => ({
            ...current,
            [connectionScope]: {
              ...current[connectionScope],
              [activeProjectPath]: targetSession.id,
            },
          }));
        }
        return targetSession.id;
      } finally {
        if (bootstrapTokenRef.current === bootstrapToken) {
          setIsBootstrappingChat(false);
          bootstrapPromiseRef.current = null;
          bootstrapTokenRef.current = undefined;
        }
      }
    })();

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }, [
    activeProjectPath,
    connection.status,
    connectionScope,
    client,
    createSession,
    currentSessionId,
    fetchSessions,
    lastSessionByConnection,
    isCurrentClient,
    messagesBySession,
    refreshMessages,
    refreshPendingInteractions,
    refreshChatCapabilities,
    refreshDiagnostics,
    refreshServerFeatures,
    refreshSessionDiff,
    refreshSessionTodos,
    sessions,
  ]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (normalizedPath === activeProjectPathRef.current) {
      return;
    }

    scopeGenerationRef.current += 1;
    setActiveProjectPath(normalizedPath);
    clearProjectState();
  }, [clearProjectState]);

  const addWorkspace = useCallback(async (directory: string) => {
    const path = directory.trim();
    if (!path) throw new Error('Enter a directory on the OpenCode server.');
    const connectionAtStart = connectionScopeRef.current;
    const scopedClient = buildClient({ ...settingsRef.current, directory: path }, serverContract);
    const project = await svcResolveWorkspace(scopedClient).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) {
        throw new Error('OpenCode could not open that directory. Check the server path.');
      }
      throw reason;
    });
    if (connectionScopeRef.current !== connectionAtStart) throw new Error('The connection changed while adding the workspace.');
    if (!project.worktree) throw new Error('OpenCode did not return a workspace path.');
    await loadWorkspaceCatalog(true);
    selectProject(project.worktree);
    return project.worktree;
  }, [loadWorkspaceCatalog, selectProject, serverContract]);



  // Connects using the settings passed in explicitly. Profile switches call
  // this directly with the target settings instead of relying on `settingsRef`
  // being updated by a render, so a switch can never connect with the previous
  // server's URL, username, or password.
  const runConnect = useCallback(async (targetSettings: OpencodeConnectionSettings): Promise<ConnectionState> => {
    // Any explicit connect (including the onboarding assistant) satisfies the
    // one-time boot connect, so completing onboarding never reconnects again.
    initialConnectStartedRef.current = true;
    if (!isValidServerUrl(targetSettings.serverUrl)) {
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, new Error('Invalid server URL.')),
        checkedAt: Date.now(),
      };
      setConnection(failed);
      return failed;
    }

    setConnection({
      status: 'connecting',
      message: `Connecting to ${getNormalizedServerUrl(targetSettings.serverUrl)}...`,
    });

    let detectedContract = serverContractRef.current;
    try {
      detectedContract = (await detectServerContract(targetSettings)).contract;
    } catch {
      detectedContract = serverContractRef.current;
    }

    // Newer OpenCode 1.x servers expose some /api compatibility routes, so a probe
    // can pick the wrong contract. Try the detected one first, then fall back to the
    // other before reporting a connection failure.
    const candidates: ServerContract[] = detectedContract === 'v1' ? ['v1', 'v2'] : ['v2', 'v1'];
    let catalog: WorkspaceCatalog | undefined;
    let activeCatalogClient: ScopedOpencodeClient | undefined;
    let usedContract: ServerContract | undefined;
    let lastError: unknown;

    for (const candidate of candidates) {
      const candidateClient = buildClient({ ...targetSettings, directory: '' }, candidate);
      catalogGenerationRef.current.set(candidateClient, serverGenerationRef.current);
      try {
        const result = await loadWorkspaceCatalog(true, candidateClient);
        if (!isCurrentCatalogClient(candidateClient)) {
          return connectionRef.current;
        }
        catalog = result;
        activeCatalogClient = candidateClient;
        usedContract = candidate;
        break;
      } catch (error) {
        lastError = error;
        if (!isContractMismatchError(error)) {
          break;
        }
      }
    }

    if (!catalog || !activeCatalogClient || !usedContract) {
      const failed: ConnectionState = {
        status: 'error',
        message: getConnectionError(targetSettings.serverUrl, lastError ?? new Error('Could not reach the OpenCode server.')),
        checkedAt: Date.now(),
      };
      setConnection(failed);
      serverProjectsRef.current = [];
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
      return failed;
    }

    if (usedContract !== serverContractRef.current) {
      serverContractRef.current = usedContract;
      setServerContract(usedContract);
    }

    const projectDirectory = catalog.currentProjectPath || catalog.serverRootPath;
    const connected: ConnectionState = {
      status: 'connected',
      message: `Connected to ${getNormalizedServerUrl(targetSettings.serverUrl)} (OpenCode ${usedContract === 'v2' ? '2.x' : '1.x'})`,
      checkedAt: Date.now(),
      projectDirectory,
    };
    setConnection(connected);

    if (!activeProjectPath && !catalog.currentProjectPath && !catalog.serverProjects[0]?.worktree) {
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
    }

    return connected;
  }, [activeProjectPath, isCurrentCatalogClient, loadWorkspaceCatalog]);

  const connect = useCallback(() => runConnect(settingsRef.current), [runConnect]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    const connectionChanged = (['serverUrl', 'username', 'password'] as const)
      .some((key) => patch[key] !== undefined && patch[key] !== settingsRef.current[key]);
    if (connectionChanged) {
      scopeGenerationRef.current += 1;
      serverGenerationRef.current += 1;
      setConnection({ status: 'idle', message: 'Connection settings changed. Reconnect to apply them.' });
      setActiveProjectPath(undefined);
      // Mirror the reset in the ref immediately so an in-flight connect for the
      // new settings cannot reuse the previous connection's project path before
      // React commits the cleared state.
      activeProjectPathRef.current = undefined;
      clearProjectState();
      setMessagesBySession({});
      setDiffsBySession({});
      setTodosBySession({});
      serverProjectsRef.current = [];
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setDiagnostics(undefined);
    }
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, [clearProjectState]);

  // Saves the outgoing profile's model selection before a switch resets
  // server-derived state. Profiles are matched by connection scope, so an
  // unsaved connection simply has nothing to update.
  const captureActiveProfilePreferences = useCallback(async () => {
    const profiles = await loadConnectionProfiles();
    const active = findMatchingProfile(profiles, settingsRef.current);
    if (!active) {
      return;
    }
    await saveConnectionProfiles(profiles.map((profile) => (
      profile.id === active.id ? { ...profile, modelPreferences: pickModelPreferences(chatPreferencesRef.current) } : profile
    )));
  }, []);

  /**
   * Switches to another connection. The order matters:
   * 1. persist the outgoing profile's preferences,
   * 2. update credentials/settings (which clears all server-derived state),
   * 3. restore the target profile's model preferences,
   * 4. reconnect using the target settings directly, not a render-delayed ref.
   */
  const switchConnection = useCallback(async (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => {
    await captureActiveProfilePreferences().catch(() => undefined);

    const targetSettings: OpencodeConnectionSettings = {
      ...settingsRef.current,
      ...next,
    };
    updateSettings(next);
    if (modelPreferences) {
      // Applied raw; the catalog refresh after connecting validates it against
      // the new server's models.
      setChatPreferences((current) => ({ ...current, ...modelPreferences }));
    }

    return runConnect(targetSettings);
  }, [captureActiveProfilePreferences, runConnect, updateSettings]);

  const ensureActiveSessionRef = useRef(ensureActiveSession);
  ensureActiveSessionRef.current = ensureActiveSession;

  const openDeepLinkSession = useCallback(
    async (target: SessionDeepLinkTarget, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> => {
      const sessionId = target.sessionId.trim();
      const projectPath = target.projectPath?.trim();
      const operation = {};
      deepLinkOperationRef.current = operation;
      const ownsOperation = () => deepLinkOperationRef.current === operation;
      const cancelOperation = () => {
        if (ownsOperation()) {
          pendingDeepLinkTargetRef.current = undefined;
          deepLinkOperationRef.current = undefined;
        }
      };
      const finish = (result: { ok: boolean; error?: string }) => {
        signal?.removeEventListener('abort', cancelOperation);
        if (ownsOperation()) {
          pendingDeepLinkTargetRef.current = undefined;
          deepLinkOperationRef.current = undefined;
        }
        return result;
      };
      signal?.addEventListener('abort', cancelOperation, { once: true });
      if (signal?.aborted) {
        cancelOperation();
        return finish({ ok: false, error: 'This session link was cancelled.' });
      }
      const connectionStatus = () => connectionRef.current.status;
      if (!sessionId) {
        return finish({ ok: false, error: 'This session link is missing a session ID.' });
      }

      if (connectionStatus() !== 'connected') {
        if (connectionStatus() !== 'connecting') {
          await connect();
        }
        const connectDeadline = Date.now() + 20000;
        while (connectionStatus() === 'connecting' && Date.now() < connectDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!ownsOperation()) {
          return finish({ ok: false, error: 'This session link was superseded.' });
        }
        if (connectionStatus() !== 'connected') {
          return finish({ ok: false, error: connectionRef.current.message || 'Could not connect to the server.' });
        }
      }

      const targetProjectPath = projectPath || activeProjectPathRef.current;
      if (!targetProjectPath) {
        return finish({ ok: false, error: 'This session link does not name a project, and no project is open.' });
      }
      if (projectPath && !serverProjectsRef.current.some((project) => project.worktree === projectPath)) {
        return finish({ ok: false, error: `Project ${projectPath} is not available from the configured server.` });
      }

      pendingDeepLinkTargetRef.current = { sessionId, projectPath: targetProjectPath };
      if (targetProjectPath !== activeProjectPathRef.current) {
        selectProject(targetProjectPath);
      }

      const deadline = Date.now() + 30000;
      while (ownsOperation() && activeProjectPathRef.current !== targetProjectPath && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ownsOperation()) {
        return finish({ ok: false, error: 'This session link was superseded.' });
      }
      if (activeProjectPathRef.current !== targetProjectPath) {
        return finish({ ok: false, error: `Could not open the ${targetProjectPath} project.` });
      }

      let openedSessionId: string | undefined;
      try {
        for (let attempt = 0; attempt < 2 && openedSessionId !== sessionId; attempt += 1) {
          openedSessionId = await ensureActiveSessionRef.current();
          if (!ownsOperation()) {
            return finish({ ok: false, error: 'This session link was superseded.' });
          }
          if (openedSessionId !== sessionId) await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        return finish({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not open this session link.',
        });
      }

      while (ownsOperation() && openedSessionId === sessionId && currentSessionIdRef.current !== sessionId && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ownsOperation()) {
        return finish({ ok: false, error: 'This session link was superseded.' });
      }
      if (currentSessionIdRef.current === sessionId) {
        return finish({ ok: true });
      }

      return finish({ ok: false, error: `Session ${sessionId} was not found in the ${targetProjectPath} project.` });
    },
    [connect, selectProject],
  );

  // Waits until the provider has rendered the connection scope a switch
  // targeted. `runConnect` finishing is not enough: `connectionScopeRef` only
  // updates on the render that adopts the new settings.
  const waitForConnectionScope = useCallback(async (scope: string, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (connectionScopeRef.current !== scope && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return connectionScopeRef.current === scope;
  }, []);

  // Deterministic project switch + session open for cross-workspace
  // navigation. The deep-link flow already owns that state machine (project
  // validation, scope switch, session reconciliation, not-found reporting), so
  // favorites reuse it instead of racing selectProject with openSession.
  //
  // A favorite carries the connection scope it belongs to. When it names
  // another saved connection, switch there first and wait until the provider
  // observes the new scope, so the deep-link flow can never run against the
  // previous server.
  const openSessionInProject = useCallback(async (projectPath: string, sessionId: string, targetConnectionScope?: string) => {
    if (targetConnectionScope && targetConnectionScope !== connectionScopeRef.current) {
      const profiles = await loadConnectionProfiles();
      const profile = findProfileByConnectionScope(profiles, targetConnectionScope);
      if (!profile) {
        throw new Error('This favorite belongs to a saved connection that no longer exists.');
      }
      const password = await getProfilePassword(profile.id);
      await switchConnection({
        serverUrl: profile.serverUrl,
        username: profile.username,
        password,
      }, profile.modelPreferences);
      if (!await waitForConnectionScope(targetConnectionScope)) {
        throw new Error('Could not switch to the connection that owns this favorite.');
      }
    }

    const result = await openDeepLinkSession({ sessionId, projectPath });
    if (!result.ok) {
      throw new Error(result.error || 'Could not open the session.');
    }
  }, [openDeepLinkSession, switchConnection, waitForConnectionScope]);

  useEffect(() => {
    // Boot connect runs once, only for installs that had already completed
    // onboarding when the app hydrated. A fresh install connects explicitly from
    // the onboarding assistant (which sets `initialConnectStartedRef`); if the
    // user skips the connect step, no server was configured and the app must not
    // silently connect to the default loopback URL when setup finishes.
    if (!isHydrated || initialConnectStartedRef.current) {
      return;
    }

    initialConnectStartedRef.current = true;
    if (onboardingCompleted) {
      void connect();
    }
  }, [connect, isHydrated, onboardingCompleted]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) return;
    void Promise.all([
      refreshWorktrees(),
      refreshMcpServers(),
      refreshTerminals(),
      refreshArchivedSessions(),
    ]).catch(() => undefined);
  }, [activeProjectPath, connection.status, refreshArchivedSessions, refreshMcpServers, refreshTerminals, refreshWorktrees]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    let cancelled = false;
    void ensureActiveSessionRef.current().catch((error) => {
      if (!cancelled && isCurrentClient(client)) {
        setPromptError({
          message: error instanceof Error ? error.message : 'Could not load this project.',
          occurredAt: Date.now(),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, client, connection.status, isCurrentClient]);

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
        recentModelIds: recordRecentModelId(current.recentModelIds, patch.modelId),
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
        config: {
          ...latestConfig,
          disabled_providers: (latestConfig.disabled_providers || []).filter((id) => id !== providerId),
          enabled_providers: [...enabledProviders].sort(),
        },
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

      const metadata = Object.fromEntries(
        Object.entries(values)
          .filter(([name, value]) => name !== 'key' && name !== 'token' && value.trim())
          .map(([name, value]) => [name, value.trim()]),
      );
      const auth = token
        ? { type: 'wellknown' as const, key, token }
        : { type: 'api' as const, key, ...(Object.keys(metadata).length > 0 ? { metadata } : {}) };

      await client.auth.set({ providerID: providerId, auth });
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, configureProvider, refreshChatCapabilities],
  );

  const removeProvider = useCallback(async (providerId: string) => {
    await client.auth.remove({ providerID: providerId });
    const latestConfig = currentConfig || (await client.config.get()).data;
    if (latestConfig) {
      const updatedConfig = (await client.config.update({
        config: {
          ...latestConfig,
          disabled_providers: [...new Set([...(latestConfig.disabled_providers || []), providerId])].sort(),
          enabled_providers: (latestConfig.enabled_providers || []).filter((id) => id !== providerId),
        },
      })).data;
      setCurrentConfig(updatedConfig);
    }
    await refreshChatCapabilities();
  }, [client, currentConfig, refreshChatCapabilities]);

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

  const completeAutomaticProviderOAuth = useCallback(async (providerId: string) => {
    const providers = (await client.provider.list()).data;
    if (!providers?.connected.includes(providerId)) {
      throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
    }
    await configureProvider(providerId);
  }, [client, configureProvider]);

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
      let promptAccepted = false;
      const trackingKey = pendingNotificationKey(connectionScope, sessionId);
      const requestedAt = Date.now();

      try {
        busyNotificationsRef.current.delete(trackingKey);
        pendingNotificationsRef.current.set(trackingKey, { sessionId, connectionScope, requestedAt });
        if (activeProjectPath) {
          await trackPendingTaskFinishedNotification({
            sessionId,
            sessionTitle: currentSession?.title,
            projectPath: activeProjectPath,
            connectionScope,
            settings: {
              serverUrl: settingsRef.current.serverUrl,
              username: settingsRef.current.username,
            },
            requestedAt,
          }).catch(() => undefined);
        }

        setSendingState({ active: true, sessionId });
        const selectedModel = availableModels.find((model) => model.id === chatPreferences.modelId);
        if (attachments?.length && !selectedModel) {
          throw new Error('Select a model that supports attachments first.');
        }
        if (attachments?.length && !selectedModel?.supportsAttachments) {
          throw new Error(`${selectedModel?.label || 'The selected model'} does not support file attachments.`);
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
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (!isCurrentClient(client)) {
          return true;
        }
        setTimeout(() => void refreshSessions(true).catch(() => undefined), 5000);

        setCurrentSessionId(sessionId);
        // A new user turn supersedes any earlier turn the diff surface was pinned to.
        setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: undefined }));
        const nextSessions = await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
        ]);

        const refreshedSession = nextSessions.find((session) => session.id === sessionId);
        if (!refreshedSession?.title?.trim()) {
          try {
            await summarizeSessionTitle(sessionId, nextSessions);
          } catch {
            // Leave the session untitled if summarization is unavailable.
          }
        }
        return true;
      } catch (error) {
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (promptAccepted) {
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 1000 });
          return true;
        }
        setPromptError({
          message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
          occurredAt: Date.now(),
          sessionId,
        });
        if (!promptAccepted) {
          pendingNotificationsRef.current.delete(trackingKey);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
        }

        throw error;
      } finally {
        setSendingState((current) => (
          current.sessionId === sessionId
            ? { active: false, sessionId: undefined }
            : current
        ));
      }
    },
    [activeProjectPath, availableModels, chatPreferences, client, connectionScope, fetchSessions, isCurrentClient, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions, scheduleSessionRefresh, sessions, summarizeSessionTitle],
  );

  const abortSession = useCallback(
    async (sessionId: string) => {
      const trackingKey = pendingNotificationKey(connectionScope, sessionId);
      pendingNotificationsRef.current.delete(trackingKey);
      busyNotificationsRef.current.delete(trackingKey);
      await clearPendingTaskFinishedNotification(connectionScope, sessionId);
      await client.session.abort({ sessionID: sessionId });

      // Reset prompt guards immediately so the user can submit again without
      // waiting for the in-flight promptAsync to settle. sendPrompt's finally
      // block sets the same values; both writes compose to the same state.
      if (promptSubmissionRef.current.sessionId === sessionId) {
        promptSubmissionRef.current = { active: false, sessionId: undefined };
      }
      setSendingState((current) => (
        current.sessionId === sessionId
          ? { active: false, sessionId: undefined }
          : current
      ));

      await Promise.all([
        refreshSessions(true),
        refreshMessages(sessionId, true),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
      ]);
    },
    [client, connectionScope, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
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
    errorAction: speechInputErrorAction,
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

  // Stop the microphone when the app is backgrounded or the provider unmounts.
  // Without this, speech recognition stays active after the user switches apps,
  // continuing to capture audio in the background (privacy + battery cost).
  // abort() is safe to call when not listening — the underlying native call is
  // wrapped in try/catch inside useSpeechInput.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        abortSpeechInput();
      }
    });
    return () => {
      subscription.remove();
      abortSpeechInput();
    };
  }, [abortSpeechInput]);

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
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
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
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Connect to OpenCode before starting conversation mode.');
      return;
    }

    if (sendingState.active) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Wait for the current reply to finish before starting conversation mode.');
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Answer the current request before starting conversation mode.');
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
    applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, undefined);
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
    Object.entries(sessionStatuses).forEach(([sessionId, status]) => {
      const key = pendingNotificationKey(connectionScope, sessionId);
      if (status.type !== 'idle' && pendingNotificationsRef.current.has(key)) {
        busyNotificationsRef.current.add(key);
      }
    });
  }, [connectionScope, sessionStatuses]);

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

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      speechInputError,
      speechInputErrorAction,
    );
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [speechInputError, speechInputErrorAction, speechInputErrorCode, stopConversationMode]);

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
        applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, message);
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
      applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Conversation mode paused because the assistant needs your input on screen.');
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
            applyConversationFeedback(setConversationFeedback, setConversationFeedbackAction, 'Unable to play this assistant reply.');
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

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      connection.message || 'OpenCode disconnected. Conversation mode will resume when the connection returns.',
    );
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
          void refreshArchivedSessions();
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
        case 'message.removed':
        case 'message.part.updated':
        case 'message.part.removed': {
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        }
        case 'session.compacted': {
          scheduleSessionRefresh(event.properties.sessionID, { sessions: true, messages: true, diff: true, todos: true });
          return;
        }
        case 'catalog.updated':
          void refreshChatCapabilities();
          return;
        case 'project.updated':
          void refreshWorkspaceCatalog(true);
          return;
        case 'file.edited':
        case 'vcs.branch.updated':
          void refreshServerFeatures();
          return;
        case 'pty.created':
        case 'pty.updated':
        case 'pty.exited':
        case 'pty.deleted':
          void refreshTerminals();
          return;
        case 'worktree.ready':
        case 'worktree.failed':
          void refreshWorktrees();
          void refreshWorkspaceCatalog(true);
          return;
        case 'mcp.tools.changed':
        case 'mcp.browser.open.failed':
          void refreshMcpServers();
          return;
        case 'lsp.updated':
          void refreshDiagnostics();
          return;
        case 'session.diff': {
          const sessionId = event.properties.sessionID;
          // When the surface is pinned to an earlier turn, an incoming latest-turn
          // diff must not overwrite it; refresh the selected turn instead.
          if (event.properties.diff?.length > 0 && !selectedDiffMessageBySessionRef.current[sessionId]) {
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
          const subscription = await catalogClient.global.event({ signal: abortController.signal, sseMaxRetryAttempts: 1 });
          for await (const envelope of subscription.stream) {
            if (!mounted || abortController.signal.aborted) {
              break;
            }
            if (envelope && (envelope.directory === activeProjectPath || !envelope.directory)) {
              setEventStreamStatus('connected');
              retryDelay = 1000;
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
  }, [activeProjectPath, catalogClient, connection.status, refreshArchivedSessions, refreshChatCapabilities, refreshDiagnostics, refreshMcpServers, refreshPendingInteractions, refreshServerFeatures, refreshSessions, refreshTerminals, refreshWorktrees, refreshWorkspaceCatalog, scheduleSessionRefresh]);

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

    if (eventStreamStatus === 'connected') {
      return;
    }

    const interval = setInterval(() => {
      void refreshSessions(true);
      void refreshPendingInteractions();

      if (currentSessionId) {
        void Promise.all([
          refreshMessages(currentSessionId, true),
          refreshSessionDiff(currentSessionId, true),
          refreshSessionTodos(currentSessionId),
        ]);
      }

      if (conversationSessionId && conversationSessionId !== currentSessionId) {
        void Promise.all([
          refreshMessages(conversationSessionId, true),
          refreshSessionDiff(conversationSessionId, true),
          refreshSessionTodos(conversationSessionId),
        ]);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, conversationSessionId, currentSessionId, eventStreamStatus, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshSessions]);

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
      // Only prompts sent on the active connection may be completed here; a
      // task belonging to another server stays pending for its own connection
      // (foreground when it becomes active again, background otherwise).
      const pendingEntries = [...pendingNotificationsRef.current.entries()]
        .filter(([, pending]) => pending.connectionScope === connectionScope);
      if (pendingEntries.length === 0) {
        return;
      }

      for (const [key, pending] of pendingEntries) {
        const { sessionId } = pending;
        const status = sessionStatuses[sessionId];
        const oldEnough = Date.now() - pending.requestedAt >= 5000;
        if ((!busyNotificationsRef.current.has(key) && !oldEnough) || (status && status.type !== 'idle') || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
          pendingNotificationsRef.current.delete(key);
          busyNotificationsRef.current.delete(key);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
          continue;
        }
        await clearPendingTaskFinishedNotification(connectionScope, sessionId);
        if (cancelled) {
          return;
        }

        pendingNotificationsRef.current.delete(key);
        busyNotificationsRef.current.delete(key);
        await notifyTaskFinished(session.title);
      }
    }

    void flushCompletedNotifications();

    return () => {
      cancelled = true;
    };
  }, [connectionScope, sendingState.active, sendingState.sessionId, sessionStatuses, sessions]);

  const clearPromptError = useCallback(() => setPromptError(undefined), []);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    if (sessions.some((session) => session.id === currentSessionId)) {
      return;
    }

    const rememberedSessionId = activeProjectPath
      ? lastSessionByConnection[connectionScope]?.[activeProjectPath]
      : undefined;
    const fallbackSessionId = sessions.find((session) => session.id === rememberedSessionId)?.id || sessions[0]?.id;
    setCurrentSessionId(fallbackSessionId);
  }, [activeProjectPath, connectionScope, currentSessionId, lastSessionByConnection, sessions]);

  useEffect(() => {
    const keepIds = new Set<string>();
    if (currentSessionId) keepIds.add(currentSessionId);
    if (conversationSessionId) keepIds.add(conversationSessionId);
    for (const [id, status] of Object.entries(sessionStatuses)) {
      if (status.type !== 'idle') keepIds.add(id);
    }

    setMessagesBySession((current) => {
      const keys = Object.keys(current);
      if (keys.length <= keepIds.size + 1) return current;
      const next: typeof current = {};
      for (const key of keys) {
        if (keepIds.has(key)) next[key] = current[key];
      }
      return next;
    });
    setDiffsBySession((current) => {
      const keys = Object.keys(current);
      if (keys.length <= keepIds.size + 1) return current;
      const next: typeof current = {};
      for (const key of keys) {
        if (keepIds.has(key)) next[key] = current[key];
      }
      return next;
    });
    setTodosBySession((current) => {
      const keys = Object.keys(current);
      if (keys.length <= keepIds.size + 1) return current;
      const next: typeof current = {};
      for (const key of keys) {
        if (keepIds.has(key)) next[key] = current[key];
      }
      return next;
    });
  }, [currentSessionId, conversationSessionId, sessionStatuses]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => (currentSessionId ? messagesBySession[currentSessionId] || [] : []),
    [currentSessionId, messagesBySession],
  );
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
    const turns = currentMessages.filter(
      (record) => record.info.role === 'user' && (record.info.summary?.diffs?.length ?? 0) > 0,
    );
    return turns.map((record, index) => {
      const textPart = record.parts.find((part) => part.type === 'text');
      const preview = textPart && textPart.type === 'text' ? textPart.text.replace(/\s+/g, ' ').trim() : '';
      return { id: record.info.id, label: `Turn ${index + 1}`, preview: preview ? preview.slice(0, 80) : undefined };
    });
  }, [currentMessages]);
  const selectedDiffMessageId = useMemo(() => {
    if (!currentSessionId) {
      return undefined;
    }
    const selected = selectedDiffMessageBySession[currentSessionId];
    if (selected && diffTurns.some((turn) => turn.id === selected)) {
      return selected;
    }
    return diffTurns[diffTurns.length - 1]?.id;
  }, [currentSessionId, diffTurns, selectedDiffMessageBySession]);
  const currentTodos = useMemo(() => {
    if (!currentSessionId) {
      return [];
    }

    const serverTodos = todosBySession[currentSessionId];
    // OpenCode 2.x has no server-owned todo endpoint; its plan is derived from
    // the transcript's `todowrite` tool parts. V1 stays server-authoritative and
    // only derives as a fallback before the first fetch lands.
    if (serverContract !== 'v2' && serverTodos !== undefined) {
      return serverTodos;
    }

    const messages = messagesBySession[currentSessionId];
    return messages ? deriveTodosFromMessages(messages) : [];
  }, [currentSessionId, messagesBySession, serverContract, todosBySession]);
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession),
    [currentSessionId, pendingPermissionsBySession, sendingState.sessionId],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession),
    [currentSessionId, pendingQuestionsBySession, sendingState.sessionId],
  );
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const usagePricingByModel = useMemo(
    () => Object.fromEntries(availableModels.flatMap((model) => model.pricing ? [[`${model.providerID}/${model.modelID}`, model.pricing] as const] : [])),
    [availableModels],
  );
  const currentUsage = useMemo(() => aggregateSessionUsage(currentMessages, usagePricingByModel), [currentMessages, usagePricingByModel]);
  const latestAssistantTurnUsage = useMemo(
    () => getLatestAssistantTurnUsage(currentMessages, usagePricingByModel),
    [currentMessages, usagePricingByModel],
  );
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
  const serverCapabilities = useMemo(() => getServerCapabilities(serverContract), [serverContract]);

  // The conversation snapshot is memoized so the ConversationContext value only
  // changes when a conversation field changes.
  const conversation = useMemo<ConversationState>(
    () => ({
      active: conversationActive,
      feedback: conversationFeedback,
      feedbackAction: conversationFeedbackAction,
      isListening: isConversationListening,
      level: conversationListeningLevel,
      latestHeardText: conversationLatestHeardText,
      phase: conversationPhase,
      sessionId: conversationSessionId,
      statusLabel: conversationStatusLabel,
    }),
    [conversationActive, conversationFeedback, conversationFeedbackAction, isConversationListening, conversationListeningLevel, conversationLatestHeardText, conversationPhase, conversationSessionId, conversationStatusLabel],
  );

  const onboardingValue = useMemo<OnboardingContextValue>(
    () => ({ isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview }),
    [isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview],
  );

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({ settings, updateSettings, switchConnection, connection, serverCapabilities, connect, diagnostics, refreshDiagnostics, eventStreamStatus }),
    [settings, updateSettings, switchConnection, connection, serverCapabilities, connect, diagnostics, refreshDiagnostics, eventStreamStatus],
  );

  const capabilitiesValue = useMemo<CapabilitiesContextValue>(
    () => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, completeAutomaticProviderOAuth, setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth }),
    [currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, completeAutomaticProviderOAuth, setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth],
  );

  const preferencesValue = useMemo<PreferencesContextValue>(
    () => ({ chatPreferences, updateChatPreferences }),
    [chatPreferences, updateChatPreferences],
  );

  const workspaceValue = useMemo<WorkspaceContextValue>(
    () => ({ projects, activeProjectPath, activeProject, selectProject, addWorkspace, serverProjects, currentProjectPath, serverRootPath, isRefreshingWorkspaceCatalog, refreshWorkspaceCatalog, refreshWorkspaceStatus: refreshServerFeatures, workspaceFiles, workspaceFileStatuses, selectedWorkspaceFile, vcsInfo, searchWorkspaceFiles, openWorkspaceFile, saveWorkspaceFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree }),
    [projects, activeProjectPath, activeProject, selectProject, addWorkspace, serverProjects, currentProjectPath, serverRootPath, isRefreshingWorkspaceCatalog, refreshWorkspaceCatalog, refreshServerFeatures, workspaceFiles, workspaceFileStatuses, selectedWorkspaceFile, vcsInfo, searchWorkspaceFiles, openWorkspaceFile, saveWorkspaceFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree],
  );

  const sessionValue = useMemo<SessionContextValue>(
    () => ({ sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, currentSessionId, activeSession, sessionPreviewById, isRefreshingSessions, refreshSessions, openSession, ensureActiveSession, openDeepLinkSession, createSession, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, currentSessionId, activeSession, sessionPreviewById, isRefreshingSessions, refreshSessions, openSession, ensureActiveSession, openDeepLinkSession, createSession, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject],
  );

  const chatValue = useMemo<ChatContextValue>(
    () => ({ currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, refreshCurrentSession, refreshCurrentTodos, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError, clearPromptError }),
    [currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, refreshCurrentSession, refreshCurrentTodos, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError, clearPromptError],
  );

  const conversationValue = useMemo<ConversationContextValue>(
    () => ({ conversation, clearConversationFeedback, toggleConversationMode }),
    [conversation, clearConversationFeedback, toggleConversationMode],
  );

  const terminalValue = useMemo<TerminalContextValue>(
    () => ({ terminals, terminalShells, activeTerminalId, terminalOutput, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal }),
    [terminals, terminalShells, activeTerminalId, terminalOutput, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal],
  );

  const mcpValue = useMemo<McpContextValue>(
    () => ({ mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, startMcpOAuth, completeMcpOAuth }),
    [mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, startMcpOAuth, completeMcpOAuth],
  );

  // Each domain context is memoized above, so a consumer only re-renders when
  // the domain it reads changes, even though one provider owns all the state.
  return (
    <OnboardingContext.Provider value={onboardingValue}>
      <ConnectionContext.Provider value={connectionValue}>
        <CapabilitiesContext.Provider value={capabilitiesValue}>
          <PreferencesContext.Provider value={preferencesValue}>
            <WorkspaceContext.Provider value={workspaceValue}>
              <SessionContext.Provider value={sessionValue}>
                <ChatContext.Provider value={chatValue}>
                  <ConversationContext.Provider value={conversationValue}>
                    <TerminalContext.Provider value={terminalValue}>
                      <McpContext.Provider value={mcpValue}>{children}</McpContext.Provider>
                    </TerminalContext.Provider>
                  </ConversationContext.Provider>
                </ChatContext.Provider>
              </SessionContext.Provider>
            </WorkspaceContext.Provider>
          </PreferencesContext.Provider>
        </CapabilitiesContext.Provider>
      </ConnectionContext.Provider>
    </OnboardingContext.Provider>
  );
}
