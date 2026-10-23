import type { Dispatch, SetStateAction } from 'react';

import type {
  OpencodeConnectionSettings,
  PendingPermissionRequest,
  PendingQuestionRequest,
  ScopedOpencodeClient,
  ServerContract,
} from '@/lib/opencode/client';
import type { ProjectFile } from '@/lib/opencode/project-file';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type {
  Command,
  Config,
  File,
  FileDiff,
  GlobalSession,
  Project,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from '@/lib/opencode/types';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type {
  ConnectionState,
  DiffScope,
  FavoriteSession,
  ProviderAuthMethod,
  ProviderOption,
  SessionDeepLinkTarget,
  ProjectCatalog,
  ProjectPathsByConnection,
  TranscriptRefreshMode,
} from '@/providers/opencode-provider-types';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';

export type ProjectActionsInput = {
  client: ScopedOpencodeClient;
  catalogClient: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  isCurrentCatalogClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  setActiveProjectPath: Dispatch<SetStateAction<string | undefined>>;
  activeProjectPathRef: { current: string | undefined };
  clearProjectState: () => void;
  projectPathsByConnectionRef: { current: ProjectPathsByConnection };
  setProjectPathsByConnection: Dispatch<SetStateAction<ProjectPathsByConnection>>;
  serverProjectsRef: { current: Project[] };
  setServerProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectPath: Dispatch<SetStateAction<string | undefined>>;
  setServerRootPath: Dispatch<SetStateAction<string | undefined>>;
  connectionScope: string;
  connectionScopeRef: { current: string };
  isHydrated: boolean;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  sessionsRef: { current: Session[] };
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  locallyCreatedSessionsRef: { current: Map<string, number> };
  setIsRefreshingProjectCatalog: Dispatch<SetStateAction<boolean>>;
  setIsRefreshingSessions: Dispatch<SetStateAction<boolean>>;
  setIsRefreshingDiffs: Dispatch<SetStateAction<boolean>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setVcsDiffsByScope: Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  suppressedPendingRequestIdsRef?: { current: Set<string> };
  setProjectFileStatuses: Dispatch<SetStateAction<File[]>>;
  setSelectedProjectFile: Dispatch<SetStateAction<ProjectFile | undefined>>;
  setVcsInfo: Dispatch<SetStateAction<VcsInfo | undefined>>;
  setCommands: Dispatch<SetStateAction<Command[]>>;
  setDiagnostics: Dispatch<SetStateAction<Diagnostics | undefined>>;
  setDiffScopeBySession: Dispatch<SetStateAction<Record<string, DiffScope>>>;
  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };
  diffScopeBySessionRef: { current: Record<string, DiffScope> };
  currentSessionIdRef: { current: string | undefined };
  messagesBySessionRef: { current: Record<string, SessionMessageRecord[]> };
  projectFileRequestRef: { current: number };
  scopeGenerationRef: { current: number };
  sessionRefreshTimeoutsRef: { current: Record<string, ReturnType<typeof setTimeout>> };
  sessionRefreshOptionsRef: { current: Record<string, SessionRefreshOptions> };
  serverContract: ServerContract;
  settingsRef: { current: OpencodeConnectionSettings };
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
};

export type SessionActionsInput = {
  client: ScopedOpencodeClient;
  catalogClient: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  isCurrentCatalogClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connection: ConnectionState;
  connectionScope: string;
  connectionScopeRef: { current: string };
  currentSessionId?: string;
  currentSessionIdRef: { current: string | undefined };
  explicitSessionSelectionRef: { current: string | undefined };
  diffScopeBySessionRef: { current: Record<string, DiffScope> };
  sessions: Session[];
  sessionsRef: { current: Session[] };
  sessionStatuses: Record<string, SessionStatus>;
  availableModels: ModelOption[];
  messagesBySession: Record<string, SessionMessageRecord[]>;
  favoriteSessions: FavoriteSession[];
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  lastSessionByConnection: Record<string, Record<string, string>>;
  setLastSessionByConnection: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  locallyCreatedSessionsRef: { current: Map<string, number> };
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  suppressedPendingRequestIdsRef: { current: Set<string> };
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
  setArchivedSessions: Dispatch<SetStateAction<GlobalSession[]>>;
  setIsBootstrappingChat: Dispatch<SetStateAction<boolean>>;
  pendingDeepLinkTargetRef: { current: SessionDeepLinkTarget | undefined };
  bootstrapPromiseRef: { current: Promise<string | undefined> | null };
  bootstrapTokenRef: { current: object | undefined };
  fetchSessions: (silent?: boolean) => Promise<Session[]>;
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
  beginHydration: (sessionId: string) => () => void;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string) => Promise<FileDiff[]>;
  refreshSessionTodos: (sessionId: string) => Promise<Todo[]>;
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<FileDiff[]>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
  refreshSavedPermissions?: () => Promise<void>;
  chatPreferences: ChatPreferences;
};

export type ConnectionActionsInput = {
  settings: OpencodeConnectionSettings;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  controlPlaneUrl: string;
  setControlPlaneUrl: Dispatch<SetStateAction<string>>;
  connection: ConnectionState;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
  serverContract: ServerContract;
  setServerContract: Dispatch<SetStateAction<ServerContract>>;
  activeProjectPath?: string;
  setActiveProjectPath: Dispatch<SetStateAction<string | undefined>>;
  activeProjectPathRef: { current: string | undefined };
  projectPathsByConnectionRef: { current: ProjectPathsByConnection };
  connectionScopeRef: { current: string };
  clearProjectState: () => void;
  softResetProjectState: () => void;
  isHydrated: boolean;
  isCurrentCatalogClient: (candidate: object) => boolean;
  loadProjectCatalog: (silent?: boolean, targetClient?: ScopedOpencodeClient) => Promise<ProjectCatalog>;
  selectProject: (path: string) => void;
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshArchivedSessions: () => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
  ensureActiveSessionRef: { current: () => Promise<string | undefined> };
  serverProjectsRef: { current: Project[] };
  setServerProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectPath: Dispatch<SetStateAction<string | undefined>>;
  setServerRootPath: Dispatch<SetStateAction<string | undefined>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setCurrentConfig: Dispatch<SetStateAction<Config | undefined>>;
  setAvailableProviders: Dispatch<SetStateAction<ProviderOption[]>>;
  setProviderAuthMethodsById: Dispatch<SetStateAction<Record<string, ProviderAuthMethod[]>>>;
  setAvailableModels: Dispatch<SetStateAction<ModelOption[]>>;
  setAvailableAgents: Dispatch<SetStateAction<AgentOption[]>>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
  setLastSessionByConnection: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setDiagnostics: Dispatch<SetStateAction<Diagnostics | undefined>>;
  setSendingState: Dispatch<SetStateAction<{ sessionId?: string; active: boolean }>>;
  settingsRef: { current: OpencodeConnectionSettings };
  chatPreferencesRef: { current: ChatPreferences };
  serverContractRef: { current: ServerContract };
  connectionRef: { current: ConnectionState };
  serverGenerationRef: { current: number };
  catalogGenerationRef: { current: WeakMap<object, number> };
  scopeGenerationRef: { current: number };
  currentSessionIdRef: { current: string | undefined };
  pendingDeepLinkTargetRef: { current: SessionDeepLinkTarget | undefined };
  deepLinkOperationRef: { current: object | undefined };
  initialConnectStartedRef: { current: boolean };
};
