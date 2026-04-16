import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { Agent, Config, FileDiff, Project, Session, SessionStatus, Todo } from '@/lib/opencode/types';
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
  listPendingPermissions,
  listPendingQuestions,
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  setSessionArchived,
  type PendingPermissionRequest,
  type PendingQuestionAnswer,
  type PendingQuestionRequest,
  type OpencodeConnectionSettings,
} from '@/lib/opencode/client';
import {
  getHistoryPreview,
  toTranscriptEntry,
  type SessionMessageRecord,
  type TranscriptEntry,
} from '@/lib/opencode/format';
import {
  clearPendingTaskFinishedNotification,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
} from '@/lib/notifications';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  CHAT_PREFERENCES_STORAGE_KEY,
  LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '@/lib/storage-keys';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import {
  startWorkingSoundAsync,
  stopWorkingSoundAsync,
  unloadWorkingSoundAsync,
  type WorkingSoundVariant,
} from '@/lib/voice/working-sound';

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  supportsReasoning: boolean;
};

export type ProviderOption = {
  id: string;
  label: string;
  modelCount: number;
  configured: boolean;
};

export type ProviderAuthPrompt = {
  type: 'text' | 'select';
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
  when?: {
    key: string;
    op: 'eq' | 'neq';
    value: string;
  };
};

export type ProviderAuthMethod = {
  type: 'oauth' | 'api';
  label: string;
  prompts?: ProviderAuthPrompt[];
};

export type AgentOption = {
  id: string;
  label: string;
  description?: string;
};

// Browser/server-folder browsing removed

export type ReasoningLevel = 'low' | 'default' | 'high';
export type ResponseScope = 'brief' | 'balanced' | 'detailed';
export type ConversationPhase = 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';

export type ChatPreferences = {
  mode: string;
  providerId?: string;
  modelId?: string;
  enabledModelIds: string[];
  providerModelSelections: Record<string, string>;
  reasoning: ReasoningLevel;
  autoApprove: boolean;
  autoPlayAssistantReplies: boolean;
  preferOnDeviceRecognition: boolean;
  resumeListeningAfterReply: boolean;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  workingSoundEnabled: boolean;
  workingSoundVariant: WorkingSoundVariant;
  workingSoundVolume: number;
  responseScope: ResponseScope;
  includeNextActions: boolean;
};

const defaultChatPreferences: ChatPreferences = {
  mode: 'build',
  enabledModelIds: [],
  providerModelSelections: {},
  reasoning: 'default',
  autoApprove: false,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  speechRate: 1,
  workingSoundEnabled: true,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
};

type ConversationState = {
  active: boolean;
  sessionId?: string;
  phase: ConversationPhase;
  statusLabel?: string;
  feedback?: string;
  isListening: boolean;
  level: number;
};

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
  source: 'server';
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
  currentTodos: Todo[];
  currentPendingPermissions: PendingPermissionRequest[];
  currentPendingQuestions: PendingQuestionRequest[];
  sessionPreviewById: Record<string, string>;
  isRefreshingSessions: boolean;
  isRefreshingMessages: boolean;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  configuredProviders: ProviderOption[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  conversation: ConversationState;
  clearConversationFeedback: () => void;
  toggleConversationMode: () => Promise<void>;
  configureProvider: (providerId: string) => Promise<void>;
  setProviderAuth: (providerId: string, values: Record<string, string>) => Promise<void>;
  startProviderOAuth: (providerId: string, methodIndex: number, inputs?: Record<string, string>) => Promise<{ url: string; instructions?: string }>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: {
    sessionId?: string;
    active: boolean;
  };
  connect: () => Promise<void>;
  refreshSessions: (silent?: boolean) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  refreshCurrentSession: (silent?: boolean) => Promise<void>;
  refreshCurrentTodos: (silent?: boolean) => Promise<void>;
  refreshPendingRequests: (silent?: boolean) => Promise<void>;
  ensureActiveSession: () => Promise<string | undefined>;
  createSession: (title?: string) => Promise<Session>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  sendPrompt: (sessionId: string, prompt: string, attachments?: { uri: string; mime?: string; filename?: string }[]) => Promise<boolean>;
  abortSession: (sessionId: string) => Promise<void>;
  replyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject', message?: string) => Promise<void>;
  replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
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
    ? Object.entries(config.agent).find(([, value]) => value && (value as any).disable !== true)?.[0]
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

function getInitialProviderId(models: ModelOption[], config?: Config, storedProviderId?: string, modelId?: string) {
  if (storedProviderId && models.some((model) => model.providerID === storedProviderId)) {
    return storedProviderId;
  }

  const modelMatch = models.find((model) => model.id === modelId);
  if (modelMatch) {
    return modelMatch.providerID;
  }

  if (config?.model) {
    const configMatch = models.find((model) => model.id === config.model);
    if (configMatch) {
      return configMatch.providerID;
    }
  }

  return models[0]?.providerID;
}

function getModelIdForProvider(models: ModelOption[], providerId?: string, selectedModelId?: string, preferredModelId?: string) {
  const providerModels = providerId ? models.filter((model) => model.providerID === providerId) : models;
  if (providerModels.length === 0) {
    return selectedModelId;
  }

  if (selectedModelId && providerModels.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }

  if (preferredModelId && providerModels.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  return providerModels[0]?.id;
}

function getEnabledModelIds(models: ModelOption[], storedModelIds?: string[]) {
  const availableModelIds = new Set(models.map((model) => model.id));
  const nextEnabledModelIds = (storedModelIds || []).filter((modelId) => availableModelIds.has(modelId));

  return nextEnabledModelIds.length > 0 ? nextEnabledModelIds : models.map((model) => model.id);
}

function getConfiguredProviderIds(config: Config | undefined, connected: string[], models: ModelOption[]) {
  const configured = new Set<string>([
    ...(config?.enabled_providers || []),
    ...connected,
    ...Object.keys((config?.provider as any) || {}),
  ]);

  if (config?.model) {
    const modelMatch = models.find((model) => model.id === config.model);
    if (modelMatch) {
      configured.add(modelMatch.providerID);
    }
  }

  return configured;
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

function buildResponseStyleSystemPrompt(scope: ResponseScope, includeNextActions: boolean) {
  const scopeInstruction =
    scope === 'brief'
      ? 'Keep responses tightly scoped. Use short paragraphs or brief bullets and avoid extra background unless the user asks for it.'
      : scope === 'detailed'
        ? 'Give fuller explanations when helpful, but still stay conversational and focused on the user request.'
        : 'Keep responses concise and user-friendly, with only the context needed to understand the answer.';

  const nextActionsInstruction = includeNextActions
    ? 'When there are useful next actions, end with a simple explanation of the recommended next step or a short numbered list.'
    : 'Do not add next actions unless the user explicitly asks for them.';

  return `${scopeInstruction} ${nextActionsInstruction}`;
}

function buildSystemPrompt(preferences: ChatPreferences) {
  return [
    buildReasoningSystemPrompt(preferences.reasoning),
    buildResponseStyleSystemPrompt(preferences.responseScope, preferences.includeNextActions),
  ]
    .filter(Boolean)
    .join('\n\n') || undefined;
}

function getActivityLabel(entry: TranscriptEntry) {
  const runningTool = entry.details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  if (runningTool) {
    return runningTool.label;
  }

  const latestTool = [...entry.details].reverse().find((detail) => detail.kind === 'tool');
  if (latestTool) {
    return latestTool.label;
  }

  const latestPatch = [...entry.details].reverse().find((detail) => detail.kind === 'patch');
  if (latestPatch) {
    return latestPatch.label;
  }

  const latestReasoning = [...entry.details].reverse().find((detail) => detail.kind === 'reasoning');
  if (latestReasoning) {
    return latestReasoning.label;
  }

  const latestStep = [...entry.details].reverse().find((detail) => detail.kind === 'step' || detail.kind === 'subtask');
  if (latestStep) {
    return latestStep.label;
  }

  return undefined;
}

function isDisplayMessage(entry: TranscriptEntry) {
  if (entry.role === 'user') {
    return true;
  }

  return Boolean(entry.text.trim() || entry.error);
}

function getSelectedModelParts(modelId?: string) {
  if (!modelId) {
    return undefined;
  }

  const providerID = modelId.split('/')[0];
  const selectedModelID = modelId.split('/').slice(1).join('/');
  if (!providerID || !selectedModelID) {
    return undefined;
  }

  return {
    providerID,
    modelID: selectedModelID,
  };
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

function getPendingRequestSessionId(request: any) {
  const candidate =
    request?.sessionID ??
    request?.sessionId ??
    request?.session ??
    request?.session?.id ??
    request?.message?.sessionID ??
    request?.message?.sessionId ??
    request?.tool?.sessionID ??
    request?.tool?.sessionId;

  return typeof candidate === 'string' ? candidate : undefined;
}

function groupPendingRequestsBySession<T extends { id?: string }>(requests: T[]) {
  return requests.reduce<Record<string, T[]>>((acc, request: any) => {
    const sessionId = getPendingRequestSessionId(request);
    if (!sessionId) {
      return acc;
    }

    const existing = acc[sessionId] || [];
    if (request?.id && existing.some((item: any) => item?.id === request.id)) {
      return acc;
    }

    acc[sessionId] = [...existing, request];
    return acc;
  }, {});
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
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');

  const settingsRef = useRef(settings);
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const conversationPhaseRef = useRef<ConversationPhase>('off');
  const assistantReplyBaselineIdRef = useRef<string | undefined>(undefined);
  const conversationResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationCancelRequestedRef = useRef(false);
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
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

        const storedActiveProjectPath = await AsyncStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        if (storedActiveProjectPath) {
          setActiveProjectPath(storedActiveProjectPath);
        }

        const storedLastSessionByProject = await AsyncStorage.getItem(LAST_SESSION_BY_PROJECT_STORAGE_KEY);
        if (storedLastSessionByProject) {
          setLastSessionByProject(JSON.parse(storedLastSessionByProject) as Record<string, string>);
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

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (activeProjectPath) {
      void AsyncStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectPath);
      return;
    }

    void AsyncStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  }, [activeProjectPath, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(LAST_SESSION_BY_PROJECT_STORAGE_KEY, JSON.stringify(lastSessionByProject));
  }, [isHydrated, lastSessionByProject]);

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
  // v2 client for permissions/questions (cleaned up: use same exported client)
  // keep single client instance; runtime client is permissive
  const v2Client = client;
  const catalogClient = useMemo(() => buildClient({ ...settings, directory: '' }), [settings]);

  // browseServerPath stub removed

  const loadWorkspaceCatalog = useCallback(
    async (silent = false): Promise<WorkspaceCatalog> => {
      if (!silent) {
        setIsRefreshingWorkspaceCatalog(true);
      }

      try {
        const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
          catalogClient.path.get(),
          catalogClient.project.list().catch(() => undefined),
          catalogClient.project.current().catch(() => undefined),
        ]);

        const discoveredProjects = projectsResponse?.data || [];
        const currentProject = currentProjectResponse?.data;
        const dedupedProjects = new Map<string, Project>();

        if (currentProject?.worktree) {
          dedupedProjects.set(currentProject.worktree, currentProject);
        }

        discoveredProjects.forEach((project: any) => {
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
          client.session.list(),
          client.session.status(),
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
        const response = await client.session.messages({ path: { id: sessionId } });

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
        const response = await client.session.diff({ path: { id: sessionId } });

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

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
        const response = await client.session.todo({ path: { id: sessionId } });

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: response.data,
      }));

      return response.data;
    },
    [client],
  );

  const scheduleSessionRefresh = useCallback(
    (sessionId: string, options?: { messages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean; delayMs?: number }) => {
      if (!sessionId) {
        return;
      }

      const existing = sessionRefreshTimeoutsRef.current[sessionId];
      if (existing) {
        clearTimeout(existing);
      }

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];

        if (options?.sessions) {
          void refreshSessions(true);
        }
        if (options?.messages) {
          void refreshMessages(sessionId, true);
        }
        if (options?.diff) {
          void refreshSessionDiff(sessionId, true);
        }
        if (options?.todos) {
          void refreshSessionTodos(sessionId);
        }
      }, options?.delayMs ?? 150);
    },
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const refreshChatCapabilities = useCallback(async () => {
    if (!activeProjectPath) {
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
      return;
    }

    const [configResponse, providersResponse, providerAuthResponse, agentsResponse] = await Promise.all([
      client.config.get(),
      client.provider.list(),
      client.provider.auth(),
      client.app.agents(),
    ]);

    const nextConfig = configResponse.data;
    const nextModels: ModelOption[] = (providersResponse.data.all as any[])
      .flatMap((provider: any) =>
        Object.values(provider.models).map((model: any) => ({
          id: `${provider.id}/${model.id}`,
          label: model.name,
          providerID: provider.id,
          providerLabel: provider.name,
          modelID: model.id,
          supportsReasoning: model.reasoning,
        })),
      )
      .sort((left: ModelOption, right: ModelOption) => left.label.localeCompare(right.label));
    const configuredProviderIds = getConfiguredProviderIds(nextConfig, providersResponse.data.connected, nextModels);
    const configuredModels = nextModels.filter((model) => configuredProviderIds.has(model.providerID));
    const nextProviders: ProviderOption[] = (providersResponse.data.all as any[])
      .map((provider: any) => ({
        id: provider.id,
        label: provider.name,
        modelCount: Object.keys(provider.models).length,
        configured: configuredProviderIds.has(provider.id),
      }))
      .sort((left: ProviderOption, right: ProviderOption) => left.label.localeCompare(right.label));
    const nextAgents = agentsResponse.data.map(toAgentOption);

    setCurrentConfig(nextConfig);
    setAvailableProviders(nextProviders);
    setProviderAuthMethodsById((providerAuthResponse.data || {}) as Record<string, ProviderAuthMethod[]>);
    setAvailableModels(nextModels);
    setAvailableAgents(nextAgents);
    setChatPreferences((current) => {
      const enabledModelIds = getEnabledModelIds(configuredModels, current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = getInitialProviderId(configuredModels, nextConfig, current.providerId, current.modelId);
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, nextConfig, current.providerId, current.modelId);

      return {
        ...current,
        mode: getInitialMode(nextAgents, nextConfig, current.mode),
        providerId: safeProviderId,
        modelId: getModelIdForProvider(
          enabledModels,
          safeProviderId,
          getInitialModelId(enabledModels, nextConfig, current.modelId),
          safeProviderId ? current.providerModelSelections[safeProviderId] : undefined,
        ),
        enabledModelIds,
        autoApprove: isAutoApproveEnabled(nextConfig),
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
      await Promise.all([refreshMessages(sessionId), refreshSessionDiff(sessionId, true), refreshSessionTodos(sessionId)]);
    },
    [activeProjectPath, refreshMessages, refreshSessionDiff, refreshSessionTodos],
  );

  const createSession = useCallback(
    async (title?: string) => {
      const trimmedTitle = title?.trim();
      const response = trimmedTitle
        ? await client.session.create({ body: { title: trimmedTitle } })
        : await client.session.create();

      await refreshSessions(true);
      return response.data;
    },
    [client, refreshSessions],
  );

  const archiveSession = useCallback(
    async (sessionId: string) => {
      await setSessionArchived(client, sessionId, Date.now());
      await refreshSessions(true);
    },
    [client, refreshSessions],
  );

  const unarchiveSession = useCallback(
    async (sessionId: string) => {
      await setSessionArchived(client, sessionId);
      await refreshSessions(true);
    },
    [client, refreshSessions],
  );

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

      await client.session.summarize({
        path: { id: sessionId },
        body: selectedModel,
      });

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
        message: getErrorMessage(error),
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

      await Promise.all([
        refreshSessions(silent),
        refreshMessages(currentSessionId, silent),
        refreshSessionDiff(currentSessionId, true),
        refreshSessionTodos(currentSessionId),
      ]);
    },
    [currentSessionId, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
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

  const refreshPendingRequests = useCallback(
    async (_silent = false) => {
      if (!activeProjectPath) {
        setPendingPermissionsBySession({});
        setPendingQuestionsBySession({});
        return;
      }

      const [scopedPermissions, scopedQuestions, globalPermissions, globalQuestions] = await Promise.all([
        listPendingPermissions(v2Client).catch(() => []),
        listPendingQuestions(v2Client).catch(() => []),
        listPendingPermissions(catalogClient).catch(() => []),
        listPendingQuestions(catalogClient).catch(() => []),
      ]);

      const nextPermissionsBySession = groupPendingRequestsBySession<PendingPermissionRequest>([
        ...(scopedPermissions as PendingPermissionRequest[]),
        ...(globalPermissions as PendingPermissionRequest[]),
      ]);
      const nextQuestionsBySession = groupPendingRequestsBySession<PendingQuestionRequest>([
        ...(scopedQuestions as PendingQuestionRequest[]),
        ...(globalQuestions as PendingQuestionRequest[]),
      ]);

      setPendingPermissionsBySession(nextPermissionsBySession);
      setPendingQuestionsBySession(nextQuestionsBySession);
    },
    [activeProjectPath, catalogClient, v2Client],
  );

  const replyToPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject', message?: string) => {
      await replyToPendingPermission(v2Client, requestId, reply, message);
      await refreshPendingRequests(true);
      if (currentSessionId) {
        await refreshMessages(currentSessionId, true);
      }
    },
    [currentSessionId, refreshMessages, refreshPendingRequests, v2Client],
  );

  const replyToQuestion = useCallback(
    async (requestId: string, answers: PendingQuestionAnswer[]) => {
      await replyToPendingQuestion(v2Client, requestId, answers);
      await refreshPendingRequests(true);
      if (currentSessionId) {
        await refreshMessages(currentSessionId, true);
      }
    },
    [currentSessionId, refreshMessages, refreshPendingRequests, v2Client],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      await rejectPendingQuestion(v2Client, requestId);
      await refreshPendingRequests(true);
      if (currentSessionId) {
        await refreshMessages(currentSessionId, true);
      }
    },
    [currentSessionId, refreshMessages, refreshPendingRequests, v2Client],
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
      const enabledProviders = new Set(latestConfig.enabled_providers || []);
      enabledProviders.add(providerId);

      const response = await client.config.update({ body: { ...latestConfig, enabled_providers: [...enabledProviders].sort() } });

      setCurrentConfig(response.data);
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
      const normalizedEntries = Object.entries(values).filter(([, value]) => value.trim());
      const normalizedValues = Object.fromEntries(normalizedEntries);
      const token = normalizedValues.token || normalizedValues.apiKey || normalizedValues.key || normalizedEntries[0]?.[1];

      if (!token) {
        throw new Error('Enter a provider credential first.');
      }

      const auth = normalizedValues.token && normalizedValues.key
        ? { type: 'wellknown', key: normalizedValues.key, token: normalizedValues.token }
        : { type: 'api', key: token };

      await client.auth.set({ providerID: providerId, auth });
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, configureProvider, refreshChatCapabilities],
  );

  const startProviderOAuth = useCallback(
    async (providerId: string, methodIndex: number, inputs?: Record<string, string>) => {
      const response = await client.provider.oauth.authorize({
        providerID: providerId,
        method: methodIndex,
        inputs,
      });

      await configureProvider(providerId);

      return {
        url: response.data.url,
        instructions: response.data.instructions,
      };
    },
    [client, configureProvider],
  );

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const response = await client.config.update({ body: nextConfig });

      setCurrentConfig(response.data);
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
      if (!trimmedPrompt) {
        return false;
      }

      if (promptSubmissionRef.current.active) {
        return false;
      }

      promptSubmissionRef.current = { active: true, sessionId };

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
        // Prepare file parts. For local URIs (file://, content://, asset://) try to read
        // the file and convert to a data URL (base64). This makes the bytes available
        // to the server even when it cannot fetch local device URIs.
        const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const filename = att.filename || att.uri.split('/').pop();
            const mime = att.mime || 'application/octet-stream';

            // If it's already a remote URL, use as-is.
            if (/^https?:\/\//i.test(att.uri)) {
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
              continue;
            }

            // Attempt to read local file and encode as data URL. Use dynamic import to
            // avoid requiring expo-file-system in environments that don't have it.
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const FileSystem = await import('expo-file-system/legacy');
              // readAsStringAsync supports file:// and content:// URIs on React Native
              const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: 'base64' });
              const dataUrl = `data:${mime};base64,${base64}`;
              preparedFileParts.push({ type: 'file', mime, filename, url: dataUrl });
            } catch (err) {
              // If reading fails, fall back to passing the original URI. The server
              // may still support some schemes or an MCP server may be able to fetch.
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
            }
          }
        }

        const body = {
          agent: chatPreferences.mode,
          model: getSelectedModelParts(chatPreferences.modelId),
          system: buildSystemPrompt(chatPreferences),
          parts: [
            {
              type: 'text',
              text: trimmedPrompt,
            },
            ...preparedFileParts,
          ],
        };

        if (typeof client.session.promptAsync === 'function') {
          await client.session.promptAsync({
            path: { id: sessionId },
            body,
          });
        } else {
          await client.session.prompt({
            path: { id: sessionId },
            body,
          });
        }
        promptAccepted = true;
        promptSubmissionRef.current = { active: false, sessionId: undefined };

        setCurrentSessionId(sessionId);
        const nextSessions = await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
          refreshPendingRequests(true),
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
        if (!promptAccepted) {
          pendingNotificationSessionIdsRef.current.delete(sessionId);
          await clearPendingTaskFinishedNotification(sessionId);
        }

        throw error;
      } finally {
        setSendingState({ active: false, sessionId: undefined });
      }
    },
    [activeProjectPath, chatPreferences, client, fetchSessions, refreshMessages, refreshPendingRequests, refreshSessionDiff, refreshSessionTodos, sessions, summarizeSessionTitle],
  );

  const abortSession = useCallback(
    async (sessionId: string) => {
      pendingNotificationSessionIdsRef.current.delete(sessionId);
      await clearPendingTaskFinishedNotification(sessionId);
        await client.session.abort({ path: { id: sessionId } });

      await Promise.all([
        refreshSessions(true),
        refreshMessages(sessionId, true),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
        refreshPendingRequests(true),
      ]);
    },
    [client, refreshMessages, refreshPendingRequests, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onResult: (transcript, isFinal) => {
      if (conversationPhaseRef.current === 'off') {
        return;
      }

      if (isFinal && transcript.trim()) {
        setPendingConversationTurn(transcript.trim());
        setConversationPhase('submitting');
      }
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
  });
  const {
    abort: abortSpeechInput,
    error: speechInputError,
    isListening: isConversationListening,
    level: conversationListeningLevel,
    start: startSpeechInput,
  } = speechInput;

  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => {
      if (!sessionId) {
        return undefined;
      }

      const transcript = (messagesBySession[sessionId] || []).map(toTranscriptEntry).filter(isDisplayMessage);
      return [...transcript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim());
    },
    [messagesBySession],
  );

  const clearConversationFeedback = useCallback(() => {
    setConversationFeedback(undefined);
  }, []);

  const stopConversationMode = useCallback(async () => {
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
  }, [abortSpeechInput]);

  const startConversationListening = useCallback(async (sessionId?: string) => {
    if (!sessionId && !conversationSessionId) {
      return false;
    }

    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = false;
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    await stopWorkingSoundAsync().catch(() => undefined);

    const started = await startSpeechInput({ continuous: false });
    if (!started) {
      setConversationPhase('off');
      return false;
    }

    setConversationPhase('listening');
    return true;
  }, [conversationSessionId, startSpeechInput]);

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

    const pendingInteractionCount = Object.values(pendingPermissionsBySession).flat().length + Object.values(pendingQuestionsBySession).flat().length;
    if (pendingInteractionCount > 0) {
      setConversationFeedback('Answer the current on-screen questions before starting conversation mode.');
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
  }, [conversationPhase]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' || conversationPhaseRef.current === 'off') {
        return;
      }

      setConversationFeedback('Conversation mode stopped because the app left the foreground.');
      void stopConversationMode();
    });

    return () => subscription.remove();
  }, [stopConversationMode]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    setConversationFeedback(speechInputError);
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [speechInputError, stopConversationMode]);

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
      if (chatPreferences.workingSoundEnabled) {
        void startWorkingSoundAsync(chatPreferences.workingSoundVariant, chatPreferences.workingSoundVolume).catch(() => undefined);
      }
      return () => {
        void stopWorkingSoundAsync().catch(() => undefined);
      };
    }

    void stopWorkingSoundAsync().catch(() => undefined);
    if (latestAssistantEntry && latestAssistantEntry.id !== assistantReplyBaselineIdRef.current) {
      const started = speakText({
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
    chatPreferences.workingSoundEnabled,
    chatPreferences.workingSoundVariant,
    chatPreferences.workingSoundVolume,
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

    setConversationFeedback('Conversation mode stopped because OpenCode disconnected.');
    void stopConversationMode();
  }, [connection.status, conversationPhase, stopConversationMode]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      setEventStreamStatus('idle');
      return;
    }

    const abortController = new AbortController();
    let mounted = true;

    const handleEvent = (event: any) => {
      if (!event?.type) {
        return;
      }

      switch (event.type) {
        case 'session.created':
        case 'session.updated':
        case 'session.deleted':
          void refreshSessions(true);
          return;
        case 'session.status': {
          const sessionId = event.properties?.sessionID;
          if (typeof sessionId === 'string') {
            setSessionStatuses((current) => ({
              ...current,
              [sessionId]: event.properties.status,
            }));
            scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true });
          }
          return;
        }
        case 'session.idle': {
          const sessionId = event.properties?.sessionID;
          if (typeof sessionId === 'string') {
            setSessionStatuses((current) => ({
              ...current,
              [sessionId]: { type: 'idle' },
            }));
            scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 50 });
          }
          return;
        }
        case 'message.updated': {
          const sessionId = event.properties?.info?.sessionID;
          if (typeof sessionId === 'string') {
            scheduleSessionRefresh(sessionId, { messages: true });
          }
          return;
        }
        case 'message.part.updated':
        case 'message.part.removed': {
          const sessionId = event.properties?.part?.sessionID ?? event.properties?.sessionID;
          if (typeof sessionId === 'string') {
            scheduleSessionRefresh(sessionId, { messages: true });
          }
          return;
        }
        case 'session.diff': {
          const sessionId = event.properties?.sessionID;
          if (typeof sessionId === 'string') {
            setDiffsBySession((current) => ({
              ...current,
              [sessionId]: event.properties.diff || [],
            }));
          }
          return;
        }
        case 'todo.updated': {
          const sessionId = event.properties?.sessionID;
          if (typeof sessionId === 'string') {
            setTodosBySession((current) => ({
              ...current,
              [sessionId]: event.properties.todos || [],
            }));
          }
          return;
        }
        case 'permission.updated':
        case 'permission.replied':
          void refreshPendingRequests(true);
          return;
        default:
          return;
      }
    };

    const subscribe = async () => {
      setEventStreamStatus('connecting');

      try {
        const subscription = await client.event.subscribe({ signal: abortController.signal });
        if (!mounted) {
          abortController.abort();
          return;
        }

        setEventStreamStatus('connected');
        for await (const event of subscription.stream) {
          if (!mounted || abortController.signal.aborted) {
            break;
          }

          handleEvent(event);
        }
      } catch {
        if (!abortController.signal.aborted && mounted) {
          setEventStreamStatus('error');
        }
      }
    };

    void subscribe();

    return () => {
      mounted = false;
      abortController.abort();
    };
  }, [activeProjectPath, client, connection.status, refreshPendingRequests, refreshSessions, scheduleSessionRefresh]);

  useEffect(
    () => () => {
      Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      sessionRefreshTimeoutsRef.current = {};
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
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
    const interval = setInterval(() => {
      void refreshPendingRequests(true);

      if (hasBusySession || sendingState.active) {
        void refreshSessions(true);
      }

      if (currentSessionId && (hasBusySession || sendingState.active)) {
        void Promise.all([
          refreshMessages(currentSessionId, true),
          refreshSessionDiff(currentSessionId, true),
          refreshSessionTodos(currentSessionId),
        ]);
      }

      if (conversationSessionId && conversationSessionId !== currentSessionId && (conversationPhase !== 'off' || hasBusySession || sendingState.active)) {
        void Promise.all([
          refreshMessages(conversationSessionId, true),
          refreshSessionDiff(conversationSessionId, true),
          refreshSessionTodos(conversationSessionId),
        ]);
      }
    }, eventStreamStatus === 'connected' ? 10000 : 2500);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, conversationPhase, conversationSessionId, currentSessionId, eventStreamStatus, refreshMessages, refreshPendingRequests, refreshSessionDiff, refreshSessionTodos, refreshSessions, sendingState.active, sessionStatuses]);

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
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath || !currentSessionId) {
      setPendingPermissionsBySession({});
      setPendingQuestionsBySession({});
      return;
    }

    void refreshPendingRequests(true);
  }, [activeProjectPath, connection.status, currentSessionId, refreshPendingRequests]);

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
    () => {
      const candidateSessionIds = [...new Set([currentSessionId, sendingState.sessionId].filter(Boolean))] as string[];
      const matches = candidateSessionIds.flatMap((sessionId) => pendingPermissionsBySession[sessionId] || []);

      return matches.length > 0 ? matches : Object.values(pendingPermissionsBySession).flat();
    },
    [currentSessionId, pendingPermissionsBySession, sendingState.sessionId],
  );
  const currentPendingQuestions = useMemo(
    () => {
      const candidateSessionIds = [...new Set([currentSessionId, sendingState.sessionId].filter(Boolean))] as string[];
      const matches = candidateSessionIds.flatMap((sessionId) => pendingQuestionsBySession[sessionId] || []);

      return matches.length > 0 ? matches : Object.values(pendingQuestionsBySession).flat();
    },
    [currentSessionId, pendingQuestionsBySession, sendingState.sessionId],
  );
  const configuredProviders = useMemo(
    () => availableProviders.filter((provider) => provider.configured),
    [availableProviders],
  );
  const currentTranscript = useMemo(() => currentMessages.map(toTranscriptEntry), [currentMessages]);
  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => conversationMessages.map(toTranscriptEntry), [conversationMessages]);
  const conversationDisplayTranscript = useMemo(
    () => conversationTranscript.filter(isDisplayMessage),
    [conversationTranscript],
  );
  const latestConversationAssistantEntry = useMemo(
    () => [...conversationDisplayTranscript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim()),
    [conversationDisplayTranscript],
  );
  const conversationCurrentActivityLabel = useMemo(() => {
    for (let index = conversationTranscript.length - 1; index >= 0; index -= 1) {
      const entry = conversationTranscript[index];
      if (isDisplayMessage(entry)) {
        continue;
      }

      const label = getActivityLabel(entry);
      if (label) {
        return label;
      }
    }

    return undefined;
  }, [conversationTranscript]);
  const conversationPendingInteractions = useMemo(() => {
    if (!conversationSessionId) {
      return 0;
    }

    return (pendingPermissionsBySession[conversationSessionId] || []).length + (pendingQuestionsBySession[conversationSessionId] || []).length;
  }, [conversationSessionId, pendingPermissionsBySession, pendingQuestionsBySession]);
  const conversationRunning = useMemo(() => {
    if (!conversationSessionId) {
      return false;
    }

    const status = sessionStatuses[conversationSessionId];
    return sendingState.sessionId === conversationSessionId || sendingState.active || (!!status && status.type !== 'idle');
  }, [conversationSessionId, sendingState.active, sendingState.sessionId, sessionStatuses]);
  const conversationActive = conversationPhase !== 'off';
  const conversationStatusLabel = useMemo(() => {
    switch (conversationPhase) {
      case 'listening':
        return 'Listening';
      case 'submitting':
        return 'Sending';
      case 'waiting':
        return conversationCurrentActivityLabel || 'Thinking';
      case 'speaking':
        return 'Speaking';
      default:
        return undefined;
    }
  }, [conversationCurrentActivityLabel, conversationPhase]);
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
        phase: conversationPhase,
        sessionId: conversationSessionId,
        statusLabel: conversationStatusLabel,
      },
      clearConversationFeedback,
      toggleConversationMode,
      configureProvider,
      setProviderAuth,
      startProviderOAuth,
      setAutoApprove,
      sendingState,
      connect,
      refreshSessions,
      openSession,
      refreshCurrentSession,
      refreshCurrentTodos,
      refreshPendingRequests,
      ensureActiveSession,
      createSession,
      archiveSession,
      unarchiveSession,
      sendPrompt,
      abortSession,
      replyToPermission,
      replyToQuestion,
      rejectQuestion,
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
      archiveSession,
      unarchiveSession,
      configureProvider,
      currentMessages,
      currentSessionId,
      currentTranscript,
      currentTodos,
      currentPendingPermissions,
      currentPendingQuestions,
      chatPreferences,
      clearConversationFeedback,
      conversationActive,
      conversationFeedback,
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
      currentProjectPath,
      projects,
      refreshCurrentSession,
      refreshCurrentTodos,
      refreshPendingRequests,
      refreshWorkspaceCatalog,
      refreshSessions,
      rejectQuestion,
      replyToPermission,
      replyToQuestion,
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
      toggleConversationMode,
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
