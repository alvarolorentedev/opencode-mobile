import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  defaultConnectionSettings,
  type OpencodeConnectionSettings,
  type PendingPermissionRequest,
  type PendingQuestionRequest,
  type SavedPermissionRule,
  type ServerContract,
} from '@/lib/opencode/client';
import { getConnectionScope } from '@/lib/connection-scope';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import { getConnectControlPlanes } from '@/lib/connect';
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
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
import type {
  ConnectionState,
  DiffScope,
  FavoriteSession,
  ProviderAuthMethod,
  ProviderOption,
} from '@/providers/opencode-provider-types';
import type { Diagnostics } from '@/providers/services/diagnostics-service';

export function useOpencodeProviderState() {
  const [settings, setSettings] = useState<OpencodeConnectionSettings>(defaultConnectionSettings);
  const [controlPlaneUrl, setControlPlaneUrl] = useState(() => getConnectControlPlanes()[0] ?? '');
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'idle',
    message: 'Add a server URL and connect to OpenCode.',
  });
  const [serverContract, setServerContract] = useState<ServerContract>('v1');
  const [activeProjectPath, setActiveProjectPath] = useState<string>();
  const [onboardingVersion, setOnboardingVersion] = useState(0);
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
  const [mcpAuthPrompt, setMcpAuthPrompt] = useState<{ mcpName: string; url: string }>();
  const [savedPermissions, setSavedPermissions] = useState<SavedPermissionRule[]>([]);
  const [serverProjects, setServerProjects] = useState<Project[]>([]);
  const [currentProjectPath, setCurrentProjectPath] = useState<string>();
  const [serverRootPath, setServerRootPath] = useState<string>();
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);
  const [isRefreshingWorkspaceCatalog, setIsRefreshingWorkspaceCatalog] = useState(false);
  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);
  const [activeSessionsVisible, setActiveSessionsVisible] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<Config>();
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [providerAuthMethodsById, setProviderAuthMethodsById] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const [lastSessionByConnection, setLastSessionByConnection] = useState<Record<string, Record<string, string>>>({});
  const [favoriteSessions, setFavoriteSessions] = useState<FavoriteSession[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [workspaceFileStatuses, setWorkspaceFileStatuses] = useState<File[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<{ path: string; content: FileContent }>();
  const [vcsInfo, setVcsInfo] = useState<VcsInfo>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();

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
  const serverProjectsRef = useRef<Project[]>([]);
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const pendingDeepLinkTargetRef = useRef<import('@/providers/opencode-provider-types').SessionDeepLinkTarget | undefined>(undefined);
  const deepLinkOperationRef = useRef<object | undefined>(undefined);
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const catalogGenerationRef = useRef(new WeakMap<object, number>());
  const initialConnectStartedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const bootstrapTokenRef = useRef<object | undefined>(undefined);
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, { messages?: boolean; fullMessages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean }>>({});
  const diffScopeBySessionRef = useRef<Record<string, DiffScope>>({});
  const selectedDiffMessageBySessionRef = useRef<Record<string, string | undefined>>({});
  const messagesBySessionRef = useRef(messagesBySession);
  const busyNotificationsRef = useRef<Set<string>>(new Set());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  const workspaceFileRequestRef = useRef(0);

  // Latest-ref mirror. Updating refs in a layout effect (instead of during
  // render) is the React-sanctioned pattern: the mirrored values are only read
  // from callbacks, async work, and effects, all of which run after commit.
  useLayoutEffect(() => {
    serverContractRef.current = serverContract;
    settingsRef.current = settings;
    chatPreferencesRef.current = chatPreferences;
    connectionScopeRef.current = connectionScope;
    activeProjectPathRef.current = activeProjectPath;
    connectionRef.current = connection;
    currentSessionIdRef.current = currentSessionId;
    diffScopeBySessionRef.current = diffScopeBySession;
    selectedDiffMessageBySessionRef.current = selectedDiffMessageBySession;
    messagesBySessionRef.current = messagesBySession;
  });

  return {
    settings, setSettings,
    controlPlaneUrl, setControlPlaneUrl,
    connection, setConnection,
    serverContract, setServerContract,
    activeProjectPath, setActiveProjectPath,
    onboardingVersion, setOnboardingVersion,
    onboardingActive, setOnboardingActive,
    sessions, setSessions,
    archivedSessions, setArchivedSessions,
    sessionStatuses, setSessionStatuses,
    currentSessionId, setCurrentSessionId,
    messagesBySession, setMessagesBySession,
    diffsBySession, setDiffsBySession,
    vcsDiffsByScope, setVcsDiffsByScope,
    diffScopeBySession, setDiffScopeBySession,
    selectedDiffMessageBySession, setSelectedDiffMessageBySession,
    todosBySession, setTodosBySession,
    pendingPermissionsBySession, setPendingPermissionsBySession,
    pendingQuestionsBySession, setPendingQuestionsBySession,
    mcpAuthPrompt, setMcpAuthPrompt,
    savedPermissions, setSavedPermissions,
    serverProjects, setServerProjects,
    currentProjectPath, setCurrentProjectPath,
    serverRootPath, setServerRootPath,
    isRefreshingSessions, setIsRefreshingSessions,
    isRefreshingMessages, setIsRefreshingMessages,
    isRefreshingDiffs, setIsRefreshingDiffs,
    isRefreshingWorkspaceCatalog, setIsRefreshingWorkspaceCatalog,
    isBootstrappingChat, setIsBootstrappingChat,
    activeSessionsVisible, setActiveSessionsVisible,
    currentConfig, setCurrentConfig,
    availableProviders, setAvailableProviders,
    providerAuthMethodsById, setProviderAuthMethodsById,
    availableModels, setAvailableModels,
    availableAgents, setAvailableAgents,
    chatPreferences, setChatPreferences,
    lastSessionByConnection, setLastSessionByConnection,
    favoriteSessions, setFavoriteSessions,
    commands, setCommands,
    workspaceFileStatuses, setWorkspaceFileStatuses,
    selectedWorkspaceFile, setSelectedWorkspaceFile,
    vcsInfo, setVcsInfo,
    diagnostics, setDiagnostics,
    connectionScope,
    settingsRef,
    chatPreferencesRef,
    connectionScopeRef,
    activeProjectPathRef,
    connectionRef,
    serverContractRef,
    serverProjectsRef,
    currentSessionIdRef,
    pendingDeepLinkTargetRef,
    deepLinkOperationRef,
    scopeGenerationRef,
    serverGenerationRef,
    clientGenerationRef,
    catalogGenerationRef,
    initialConnectStartedRef,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    diffScopeBySessionRef,
    selectedDiffMessageBySessionRef,
    messagesBySessionRef,
    busyNotificationsRef,
    promptSubmissionRef,
    workspaceFileRequestRef,
  };
}

export type OpencodeProviderState = ReturnType<typeof useOpencodeProviderState>;
