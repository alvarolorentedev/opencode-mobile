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
  fileClipboard?: import('./use-file-clipboard').FileClipboard;
  connectionId: string;
  connected: boolean;
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
  setIsBootstrappingChat: Dispatch<SetStateAction<boolean>>;
  pendingDeepLinkTargetRef: { current: SessionDeepLinkTarget | undefined };
  bootstrapPromiseRef: { current: Promise<string | undefined> | null };
  bootstrapTokenRef: { current: object | undefined };
  refreshSessions: () => Promise<Session[]>;
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
  refreshSessions: () => Promise<unknown>;
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

// Each extracted action hook declares only the slice it consumes. The aggregate
// inputs above are the composition contracts used by the provider wiring; these
// aliases keep sub-hooks from silently depending on unrelated setters and refs.
export type ProjectCatalogInput = Pick<ProjectActionsInput,
  'client' | 'catalogClient' | 'isCurrentClient' | 'isCurrentCatalogClient' | 'activeProjectPath' |
  'setActiveProjectPath' | 'activeProjectPathRef' | 'clearProjectState' | 'projectPathsByConnectionRef' |
  'setProjectPathsByConnection' | 'serverProjectsRef' | 'setServerProjects' | 'setCurrentProjectPath' |
  'setServerRootPath' | 'connectionScope' | 'connectionScopeRef' | 'isHydrated' | 'setSessions' |
  'setSessionStatuses' | 'setIsRefreshingProjectCatalog' | 'scopeGenerationRef' | 'serverContract' | 'settingsRef'>;
export type ProjectRefreshInput = Pick<ProjectActionsInput,
  'activeProjectPath' | 'client' | 'isCurrentClient' | 'setSessions' | 'sessionsRef' | 'setSessionStatuses' |
  'locallyCreatedSessionsRef' | 'setIsRefreshingDiffs' | 'setDiffsBySession' | 'setVcsDiffsByScope' |
  'setTodosBySession' | 'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' |
  'suppressedPendingRequestIdsRef' | 'setDiffScopeBySession' | 'setSelectedDiffMessageBySession' |
  'selectedDiffMessageBySessionRef' | 'diffScopeBySessionRef' | 'currentSessionIdRef' | 'messagesBySessionRef' |
  'sessionRefreshTimeoutsRef' | 'sessionRefreshOptionsRef' | 'connectionScope' | 'refreshMessages'>;
export type ProjectFileInput = Pick<ProjectActionsInput,
  'fileClipboard' | 'connectionId' | 'connected' | 'client' | 'isCurrentClient' | 'activeProjectPath' | 'setCommands' | 'setProjectFileStatuses' | 'setVcsInfo' |
  'setDiagnostics' | 'setSelectedProjectFile' | 'projectFileRequestRef' | 'currentSessionIdRef' |
  'diffScopeBySessionRef' | 'settingsRef'> & {
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<unknown>;
};

export type SessionCrudInput = Pick<SessionActionsInput,
  'client' | 'isCurrentClient' | 'activeProjectPath' | 'connectionScopeRef' | 'currentSessionId' |
  'currentSessionIdRef' | 'explicitSessionSelectionRef' | 'locallyCreatedSessionsRef' | 'availableModels' |
  'diffScopeBySessionRef' | 'sessions' | 'sessionStatuses' | 'bootstrapPromiseRef' | 'bootstrapTokenRef' |
  'setLastSessionByConnection' | 'setCurrentSessionId' | 'setIsBootstrappingChat' | 'beginHydration' |
  'setSessions' | 'setSessionStatuses' | 'setMessagesBySession' | 'setDiffsBySession' | 'setTodosBySession' |
  'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' | 'setFavoriteSessions' | 'refreshSessions' |
  'refreshMessages' | 'refreshSessionDiff' | 'refreshSessionTodos' | 'refreshVcsDiff' |
  'refreshPendingInteractions' | 'refreshActiveSessions' | 'chatPreferences'>;
export type SessionFavoriteInput = Pick<SessionActionsInput,
  'connectionScopeRef' | 'favoriteSessions' | 'setFavoriteSessions'>;
export type SessionInteractionInput = Pick<SessionActionsInput,
  'client' | 'pendingPermissionsBySession' | 'pendingQuestionsBySession' | 'setPendingPermissionsBySession' |
  'setPendingQuestionsBySession' | 'suppressedPendingRequestIdsRef' | 'refreshMessages' | 'refreshSavedPermissions'>;
export type SessionBootstrapInput = Pick<SessionActionsInput,
  'activeProjectPath' | 'connection' | 'connectionScope' | 'client' | 'currentSessionId' | 'currentSessionIdRef' |
  'explicitSessionSelectionRef' | 'sessionsRef' | 'messagesBySession' | 'lastSessionByConnection' |
  'pendingDeepLinkTargetRef' | 'bootstrapPromiseRef' | 'bootstrapTokenRef' | 'isCurrentClient' | 'refreshSessions' |
  'refreshMessages' | 'refreshSessionDiff' | 'refreshSessionTodos' | 'refreshPendingInteractions' |
  'refreshChatCapabilities' | 'refreshServerFeatures' | 'setCurrentSessionId' | 'setLastSessionByConnection' |
  'setIsBootstrappingChat'> & {
  createSession: (title?: string) => Promise<Session>;
};

export type ConnectionConnectInput = Pick<ConnectionActionsInput,
  'settings' | 'setSettings' | 'activeProjectPath' | 'setActiveProjectPath' | 'activeProjectPathRef' |
  'clearProjectState' | 'softResetProjectState' | 'isHydrated' | 'isCurrentCatalogClient' | 'loadProjectCatalog' |
  'serverProjectsRef' | 'setServerProjects' | 'setCurrentProjectPath' | 'setServerRootPath' | 'setSessions' |
  'setSessionStatuses' | 'setCurrentConfig' | 'setAvailableProviders' | 'setProviderAuthMethodsById' |
  'setAvailableModels' | 'setAvailableAgents' | 'setMessagesBySession' | 'setDiffsBySession' | 'setTodosBySession' |
  'setChatPreferences' | 'setDiagnostics' | 'setSendingState' | 'setConnection' | 'setServerContract' | 'settingsRef' |
  'chatPreferencesRef' | 'serverContractRef' | 'connectionRef' | 'serverGenerationRef' | 'catalogGenerationRef' |
  'scopeGenerationRef' | 'initialConnectStartedRef'> & {
  connectSetup: import('@/providers/use-connect-state').ConnectSetup;
};
