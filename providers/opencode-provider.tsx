import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Agent, Config, FileDiff, Project, Session, SessionStatus } from '@opencode-ai/sdk/client';
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

import {
  buildClient,
  defaultConnectionSettings,
  getNormalizedServerUrl,
  type OpencodeConnectionSettings,
} from '@/lib/opencode/client';
import {
  getHistoryPreview,
  toTranscriptEntry,
  type SessionMessageRecord,
  type TranscriptEntry,
} from '@/lib/opencode/format';

const SETTINGS_STORAGE_KEY = 'opencode-mobile.settings';
const CHAT_PREFERENCES_STORAGE_KEY = 'opencode-mobile.chat-preferences';

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  modelID: string;
  supportsReasoning: boolean;
};

export type AgentOption = {
  id: string;
  label: string;
  description?: string;
};

// Browser/server-folder browsing removed

export type ReasoningLevel = 'low' | 'default' | 'high';

export type ChatPreferences = {
  mode: string;
  modelId?: string;
  reasoning: ReasoningLevel;
  autoApprove: boolean;
};

const defaultChatPreferences: ChatPreferences = {
  mode: 'build',
  reasoning: 'default',
  autoApprove: false,
};

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
  source: 'server' | 'browser';
  updatedAt?: number;
  isCurrent?: boolean;
};

type ConnectionState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  checkedAt?: number;
  projectDirectory?: string;
};

type WorkspaceCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

type OpencodeContextValue = {
  isHydrated: boolean;
  settings: OpencodeConnectionSettings;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
  connection: ConnectionState;
  projects: OpencodeProject[];
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  selectProject: (path: string) => void;
  serverProjects: Project[];
  currentProjectPath?: string;
  serverRootPath?: string;
  isRefreshingWorkspaceCatalog: boolean;
  refreshWorkspaceCatalog: (silent?: boolean) => Promise<void>;
  // browsing server folders removed
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  currentSessionId?: string;
  activeSession?: Session;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  currentDiffs: FileDiff[];
  sessionPreviewById: Record<string, string>;
  isRefreshingSessions: boolean;
  isRefreshingMessages: boolean;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  currentConfig?: Config;
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: {
    sessionId?: string;
    active: boolean;
  };
  connect: () => Promise<void>;
  refreshSessions: (silent?: boolean) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  refreshCurrentSession: (silent?: boolean) => Promise<void>;
  ensureActiveSession: () => Promise<string | undefined>;
  createSession: (title?: string) => Promise<Session>;
  sendPrompt: (sessionId: string, prompt: string) => Promise<void>;
};

const OpencodeContext = createContext<OpencodeContextValue | null>(null);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong while talking to OpenCode.';
}

function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

function getParentPath(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  if (!normalized || normalized === '/') {
    return undefined;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '/';
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

function toAgentOption(agent: Agent): AgentOption {
  return {
    id: agent.name,
    label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
    description: agent.description,
  };
}

function getInitialMode(agents: AgentOption[], config?: Config, storedMode?: string) {
  if (storedMode && agents.some((agent) => agent.id === storedMode)) {
    return storedMode;
  }

  const configuredAgent = config?.agent
    ? Object.entries(config.agent).find(([, value]) => value && value.disable !== true)?.[0]
    : undefined;
  if (configuredAgent && agents.some((agent) => agent.id === configuredAgent)) {
    return configuredAgent;
  }

  const preferred = agents.find((agent) => agent.id === 'build') || agents.find((agent) => agent.id === 'general');
  return preferred?.id || agents[0]?.id || defaultChatPreferences.mode;
}

function getInitialModelId(models: ModelOption[], config?: Config, storedModelId?: string) {
  if (storedModelId && models.some((model) => model.id === storedModelId)) {
    return storedModelId;
  }

  if (config?.model && models.some((model) => model.id === config.model)) {
    return config.model;
  }

  return models[0]?.id;
}

function isAutoApproveEnabled(config?: Config) {
  if (!config?.permission) {
    return false;
  }

  const { bash, doom_loop, edit, external_directory, webfetch } = config.permission;
  return edit === 'allow' && bash === 'allow' && webfetch === 'allow' && doom_loop === 'allow' && external_directory === 'allow';
}

function buildReasoningSystemPrompt(level: ReasoningLevel) {
  if (level === 'default') {
    return undefined;
  }

  if (level === 'low') {
    return 'Reasoning effort: low. Keep the solution direct, concise, and avoid unnecessary exploration unless needed.';
  }

  return 'Reasoning effort: high. Spend extra time planning, evaluating tradeoffs, and verifying the best path before acting.';
}

function mergePermissionConfig(config: Config | undefined, enabled: boolean): Config {
  return {
    ...(config || {}),
    permission: {
      ...config?.permission,
      edit: enabled ? 'allow' : 'ask',
      bash: enabled ? 'allow' : 'ask',
      webfetch: enabled ? 'allow' : 'ask',
      doom_loop: enabled ? 'allow' : 'ask',
      external_directory: enabled ? 'allow' : 'ask',
    },
  };
}

export function OpencodeProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
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
  const [currentConfig, setCurrentConfig] = useState<Config>();
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);

  const settingsRef = useRef(settings);
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    async function hydrateState() {
      try {
        const storedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);

        if (storedSettings) {
          const parsed = JSON.parse(storedSettings) as Partial<OpencodeConnectionSettings>;
          setSettings({
            ...defaultConnectionSettings,
            ...parsed,
          });
        }

        const storedChatPreferences = await AsyncStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
        if (storedChatPreferences) {
          const parsed = JSON.parse(storedChatPreferences) as Partial<ChatPreferences>;
          setChatPreferences({
            ...defaultChatPreferences,
            ...parsed,
          });
        }
      } catch {
        // Ignore hydration issues and keep defaults.
      } finally {
        setIsHydrated(true);
      }
    }

    void hydrateState();
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [isHydrated, settings]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(chatPreferences));
  }, [chatPreferences, isHydrated]);

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
        source: 'browser',
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
        const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
          catalogClient.path.get<true>(),
          catalogClient.project.list<true>().catch(() => undefined),
          catalogClient.project.current<true>().catch(() => undefined),
        ]);

        const discoveredProjects = projectsResponse?.data || [];
        const currentProject = currentProjectResponse?.data;
        const dedupedProjects = new Map<string, Project>();

        if (currentProject?.worktree) {
          dedupedProjects.set(currentProject.worktree, currentProject);
        }

        discoveredProjects.forEach((project) => {
          dedupedProjects.set(project.worktree, project);
        });

        const nextProjects = [...dedupedProjects.values()].sort(
          (left, right) => (right.time.initialized || right.time.created) - (left.time.initialized || left.time.created),
        );

        setServerProjects(nextProjects);
        setCurrentProjectPath(currentProject?.worktree);
        setServerRootPath(pathResponse.data.directory);
        setActiveProjectPath((current) => current || currentProject?.worktree || nextProjects[0]?.worktree);

        return {
          currentProjectPath: currentProject?.worktree,
          serverRootPath: pathResponse.data.directory,
          serverProjects: nextProjects,
        };
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
        const [sessionsResponse, statusesResponse] = await Promise.all([
          client.session.list<true>(),
          client.session.status<true>(),
        ]);

        const nextSessions = [...sessionsResponse.data].sort(
          (left, right) => right.time.updated - left.time.updated,
        );

        setSessions(nextSessions);
        setSessionStatuses(statusesResponse.data);
        return nextSessions;
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
        const response = await client.session.messages({
          throwOnError: true,
          path: { id: sessionId },
        });

        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: response.data,
        }));

        return response.data;
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
        const response = await client.session.diff({
          throwOnError: true,
          path: { id: sessionId },
        });

        setDiffsBySession((current) => ({
          ...current,
          [sessionId]: response.data,
        }));

        return response.data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client],
  );

  const refreshChatCapabilities = useCallback(async () => {
    if (!activeProjectPath) {
      setCurrentConfig(undefined);
      setAvailableModels([]);
      setAvailableAgents([]);
      return;
    }

    const [configResponse, providersResponse, agentsResponse] = await Promise.all([
      client.config.get({ throwOnError: true }),
      client.provider.list({ throwOnError: true }),
      client.app.agents({ throwOnError: true }),
    ]);

    const nextConfig = configResponse.data;
    const nextModels = providersResponse.data.all
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          id: `${provider.id}/${model.id}`,
          label: model.name,
          providerID: provider.id,
          modelID: model.id,
          supportsReasoning: model.reasoning,
        })),
      )
      .sort((left, right) => left.label.localeCompare(right.label));
    const nextAgents = agentsResponse.data.map(toAgentOption);

    setCurrentConfig(nextConfig);
    setAvailableModels(nextModels);
    setAvailableAgents(nextAgents);
    setChatPreferences((current) => ({
      ...current,
      mode: getInitialMode(nextAgents, nextConfig, current.mode),
      modelId: getInitialModelId(nextModels, nextConfig, current.modelId),
      autoApprove: isAutoApproveEnabled(nextConfig),
    }));
  }, [activeProjectPath, client]);

  const openSession = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      await Promise.all([refreshMessages(sessionId), refreshSessionDiff(sessionId, true)]);
    },
    [refreshMessages, refreshSessionDiff],
  );

  const createSession = useCallback(
    async (title?: string) => {
      const response = await client.session.create({
        throwOnError: true,
        body: {
          title: title?.trim() || 'New chat',
        },
      });

      await refreshSessions(true);
      return response.data;
    },
    [client, refreshSessions],
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
        const targetSession = nextSessions[0] ?? (await createSession());
        setCurrentSessionId(targetSession.id);
        await Promise.all([refreshMessages(targetSession.id, true), refreshSessionDiff(targetSession.id, true)]);
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
    messagesBySession,
    refreshMessages,
    refreshSessionDiff,
    sessions,
  ]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    setActiveProjectPath(normalizedPath);
    setCurrentSessionId(undefined);
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
        await Promise.all([fetchSessions(true), refreshChatCapabilities()]);
      } else {
        setSessions([]);
        setSessionStatuses({});
        setCurrentConfig(undefined);
        setAvailableModels([]);
        setAvailableAgents([]);
      }
    } catch (error) {
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setConnection({
        status: 'error',
        message: getErrorMessage(error),
        checkedAt: Date.now(),
      });
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableModels([]);
      setAvailableAgents([]);
    }
  }, [activeProjectPath, fetchSessions, loadWorkspaceCatalog, refreshChatCapabilities]);

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

      await Promise.all([refreshSessions(silent), refreshMessages(currentSessionId, silent), refreshSessionDiff(currentSessionId, true)]);
    },
    [currentSessionId, refreshMessages, refreshSessionDiff, refreshSessions],
  );

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
    setChatPreferences((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      const latestConfig = currentConfig || (await client.config.get({ throwOnError: true })).data;
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const response = await client.config.update({
        throwOnError: true,
        body: nextConfig,
      });

      setCurrentConfig(response.data);
      setChatPreferences((current) => ({
        ...current,
        autoApprove: enabled,
      }));
    },
    [client, currentConfig],
  );

  const sendPrompt = useCallback(
    async (sessionId: string, prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        return;
      }

      setSendingState({ active: true, sessionId });

      try {
        await client.session.prompt({
          throwOnError: true,
          path: { id: sessionId },
          body: {
            agent: chatPreferences.mode,
            model: chatPreferences.modelId
              ? {
                  providerID: chatPreferences.modelId.split('/')[0],
                  modelID: chatPreferences.modelId.split('/').slice(1).join('/'),
                }
              : undefined,
            system: buildReasoningSystemPrompt(chatPreferences.reasoning),
            parts: [
              {
                type: 'text',
                text: trimmedPrompt,
              },
            ],
          },
        });

        setCurrentSessionId(sessionId);
        await Promise.all([refreshSessions(true), refreshMessages(sessionId, true), refreshSessionDiff(sessionId, true)]);
      } finally {
        setSendingState({ active: false, sessionId: undefined });
      }
    },
    [chatPreferences.mode, chatPreferences.modelId, chatPreferences.reasoning, client, refreshMessages, refreshSessionDiff, refreshSessions],
  );

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    const hasBusySession = Object.values(sessionStatuses).some((status) => status.type !== 'idle');
    if (!hasBusySession && !sendingState.active) {
      return;
    }

    const interval = setInterval(() => {
      void refreshSessions(true);
      if (currentSessionId) {
        void Promise.all([refreshMessages(currentSessionId, true), refreshSessionDiff(currentSessionId, true)]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, currentSessionId, refreshMessages, refreshSessionDiff, refreshSessions, sendingState.active, sessionStatuses]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    if (sessions.some((session) => session.id === currentSessionId)) {
      return;
    }

    setCurrentSessionId(sessions[0]?.id);
  }, [currentSessionId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = currentSessionId ? messagesBySession[currentSessionId] || [] : [];
  const currentDiffs = currentSessionId ? diffsBySession[currentSessionId] || [] : [];
  const currentTranscript = useMemo(() => currentMessages.map(toTranscriptEntry), [currentMessages]);
  const sessionPreviewById = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(messagesBySession).map(([sessionId, messages]) => [sessionId, getHistoryPreview(messages)]),
      ),
    [messagesBySession],
  );

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
      // browsing removed
      sessions,
      sessionStatuses,
      currentSessionId,
      activeSession,
      currentMessages,
      currentDiffs,
      currentTranscript,
      sessionPreviewById,
      isRefreshingSessions,
      isRefreshingMessages,
      isRefreshingDiffs,
      isBootstrappingChat,
      currentConfig,
      availableModels,
      availableAgents,
      chatPreferences,
      updateChatPreferences,
      setAutoApprove,
      sendingState,
      connect,
      refreshSessions,
      openSession,
      refreshCurrentSession,
      ensureActiveSession,
      createSession,
      sendPrompt,
    }),
    [
      activeSession,
      activeProject,
      activeProjectPath,
      connect,
      connection,
      currentConfig,
      currentDiffs,
      createSession,
      currentMessages,
      currentSessionId,
      currentTranscript,
      chatPreferences,
      ensureActiveSession,
      availableAgents,
      availableModels,
      isBootstrappingChat,
      isRefreshingDiffs,
      isHydrated,
      isRefreshingMessages,
      isRefreshingWorkspaceCatalog,
      isRefreshingSessions,
      openSession,
      currentProjectPath,
      projects,
      refreshCurrentSession,
      refreshWorkspaceCatalog,
      refreshSessions,
      selectProject,
      setAutoApprove,
      sendPrompt,
      sendingState,
      serverRootPath,
      sessionPreviewById,
      sessionStatuses,
      sessions,
      serverProjects,
      settings,
      updateChatPreferences,
      updateSettings,
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
