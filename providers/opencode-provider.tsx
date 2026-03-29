import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FileNode, Project, Session, SessionStatus } from '@opencode-ai/sdk/client';
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
  browserPath?: string;
  browserEntries: FileNode[];
  browserError?: string;
  isBrowsingServer: boolean;
  browseServerPath: (path?: string, silent?: boolean) => Promise<import('@opencode-ai/sdk/client').FileNode[] | undefined>;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  currentSessionId?: string;
  activeSession?: Session;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  sessionPreviewById: Record<string, string>;
  isRefreshingSessions: boolean;
  isRefreshingMessages: boolean;
  isBootstrappingChat: boolean;
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
  const [serverProjects, setServerProjects] = useState<Project[]>([]);
  const [currentProjectPath, setCurrentProjectPath] = useState<string>();
  const [serverRootPath, setServerRootPath] = useState<string>();
  const [browserPath, setBrowserPath] = useState<string>();
  const [browserEntries, setBrowserEntries] = useState<FileNode[]>([]);
  const [browserError, setBrowserError] = useState<string>();
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [isRefreshingWorkspaceCatalog, setIsRefreshingWorkspaceCatalog] = useState(false);
  const [isBrowsingServer, setIsBrowsingServer] = useState(false);
  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);
  const [sendingState, setSendingState] = useState<{ sessionId?: string; active: boolean }>({ active: false });

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

  const browseServerPath = useCallback(
    async (path?: string, silent = false) => {
      const targetPath = path?.trim() || browserPath || currentProjectPath || serverRootPath;
      if (!targetPath) {
        return;
      }

      if (!silent) {
        setIsBrowsingServer(true);
      }

      try {
        const browserClient = buildClient({ ...settingsRef.current, directory: getParentPath(targetPath) || targetPath });
        // If the input ends with a slash, list children of that path
        const listPath = targetPath.endsWith('/') ? '.' : targetPath.split('/').pop() || '.';
        const response = await browserClient.file.list({ throwOnError: true, query: { path: listPath } });

        const nextEntries = response.data
          .filter((entry) => entry.type === 'directory')
          .sort((left, right) => left.name.localeCompare(right.name));

        // If user typed a partial path (no trailing slash), use suggestions instead of replacing the path
        if (!targetPath.endsWith('/')) {
          // suggest directories that start with the last segment
          const last = targetPath.split('/').pop() || '';
          const filtered = nextEntries.filter((e) => e.name.startsWith(last));
          setBrowserEntries(nextEntries);
          setBrowserError(undefined);
          return filtered;
        }

        setBrowserPath(targetPath);
        setBrowserEntries(nextEntries);
        setBrowserError(undefined);
      } catch (error) {
        setBrowserError(getErrorMessage(error));
      } finally {
        if (!silent) {
          setIsBrowsingServer(false);
        }
      }
    },
    [browserPath, currentProjectPath, serverRootPath],
  );

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
        setBrowserPath((current) => current || currentProject?.worktree || pathResponse.data.directory);

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

  const openSession = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      await refreshMessages(sessionId);
    },
    [refreshMessages],
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
        await refreshMessages(targetSession.id, true);
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

      await browseServerPath(projectDirectory, true);

      if (activeProjectPath || catalog.currentProjectPath || catalog.serverProjects[0]?.worktree) {
        await fetchSessions(true);
      } else {
        setSessions([]);
        setSessionStatuses({});
      }
    } catch (error) {
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setBrowserEntries([]);
      setBrowserError(undefined);
      setConnection({
        status: 'error',
        message: getErrorMessage(error),
        checkedAt: Date.now(),
      });
      setSessions([]);
      setSessionStatuses({});
    }
  }, [activeProjectPath, browseServerPath, fetchSessions, loadWorkspaceCatalog]);

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

      await Promise.all([refreshSessions(silent), refreshMessages(currentSessionId, silent)]);
    },
    [currentSessionId, refreshMessages, refreshSessions],
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
            parts: [
              {
                type: 'text',
                text: trimmedPrompt,
              },
            ],
          },
        });

        setCurrentSessionId(sessionId);
        await Promise.all([refreshSessions(true), refreshMessages(sessionId, true)]);
      } finally {
        setSendingState({ active: false, sessionId: undefined });
      }
    },
    [client, refreshMessages, refreshSessions],
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
        void refreshMessages(currentSessionId, true);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, currentSessionId, refreshMessages, refreshSessions, sendingState.active, sessionStatuses]);

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
      browserPath,
      browserEntries,
      browserError,
      isBrowsingServer,
      browseServerPath,
      sessions,
      sessionStatuses,
      currentSessionId,
      activeSession,
      currentMessages,
      currentTranscript,
      sessionPreviewById,
      isRefreshingSessions,
      isRefreshingMessages,
      isBootstrappingChat,
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
      browseServerPath,
      browserEntries,
      browserError,
      browserPath,
      connect,
      connection,
      createSession,
      currentMessages,
      currentSessionId,
      currentTranscript,
      ensureActiveSession,
      isBrowsingServer,
      isBootstrappingChat,
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
      sendPrompt,
      sendingState,
      serverRootPath,
      sessionPreviewById,
      sessionStatuses,
      sessions,
      serverProjects,
      settings,
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
