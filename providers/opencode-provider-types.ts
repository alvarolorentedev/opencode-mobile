import type { useProjectBrowser } from '@/providers/use-project-browser';
import type { WorktreeCatalog } from '@/providers/use-worktree-state';
import type { PendingPrompt } from '@/lib/opencode/prompt-inbox';
import type { ProjectFile } from '@/lib/opencode/project-file';
import type {
  Command,
  Config,
  File,
  FileDiff,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Project,
  ProviderAuthMethod,
  Pty,
  ProviderAuthValues,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from '@/lib/opencode/types';
import type {
  ConnectionFailureKind,
  ManagedService,
  OpencodeConnectionSettings,
  PendingPermission,
  PendingQuestion,
  PendingQuestionAnswer,
  SavedPermissionRule,
  ServiceInput,
  ServiceManagementVersion,
} from '@/lib/opencode/client';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { NetworkStatus } from '@/lib/network-status';
import type { SessionMessageRecord, TranscriptEntry } from '@/lib/opencode/format';
import type { SessionUsage } from '@/lib/opencode/usage';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ChatPreferences, ResponseScope } from '@/providers/opencode-preferences';
import type { ServerCapabilities } from '@/providers/opencode-capabilities';
import type { SharedInput } from '@/providers/use-share-state';
import type { TerminalRuntime, TerminalStatus } from '@/providers/terminal-types';

export type { AgentOption, ChatPreferences, ModelOption, ResponseScope, ServerCapabilities };
export type { ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues } from '@/lib/opencode/types';

// How a transcript refresh treats the window already held in memory.
// - initial: no usable window; download one newest page.
// - tail: the default; download one newest page and merge it in. On no overlap
//   with the held window, adopt the fetched page rather than paging backward.
// - replace: drop the held window and adopt the fetched page. Reserved for
//   server-side history rewrites (compaction and revert).
export type TranscriptRefreshMode = 'initial' | 'tail' | 'replace';

// A stored provider credential. V2 integrations can hold several labeled
// accounts (exactly one active); V1 providers have no account list.
export type ProviderAccount = {
  id: string;
  label: string;
  method: 'key' | 'oauth';
  active: boolean;
};

export type ProviderOption = {
  id: string;
  label: string;
  configured: boolean;
  accounts?: ProviderAccount[];
};

export type ConversationPhase = 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';

export type SessionDeepLinkTarget = {
  sessionId: string;
  projectPath?: string;
  connectionScope?: string;
};

export const CONVERSATION_KEEP_AWAKE_TAG = 'opencode-conversation-mode';
export const CONVERSATION_FINAL_RESULT_SETTLE_MS = 2200;
export const CONVERSATION_LISTENING_RESTART_MS = 350;

export type ConversationState = {
  active: boolean;
  sessionId?: string;
  phase: ConversationPhase;
  statusLabel?: string;
  feedback?: string;
  // Recovery action offered alongside `feedback` when it came from a voice
  // input failure.
  feedbackAction?: VoiceRecoveryAction;
  latestHeardText?: string;
  isListening: boolean;
  level: number;
};

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
};

// Opened projects per connection scope, most-recent-first. The picker renders
// this list; the server's project catalog only enriches the entries.
export type ProjectPathsByConnection = Record<string, string[]>;

// Explicit persisted model for a pinned session. `sessionId` and `projectPath`
// are the identifiers required to reopen it; `connectionScope` says which
// server + user owns it, so identical paths or session IDs on another server
// never collide. `title` is retained because it cannot be reconstructed for
// cross-project favorites without a server call. The project label is
// derived from `projectPath` at render time and is never persisted.
export type FavoriteSession = {
  sessionId: string;
  connectionScope: string;
  projectPath: string;
  title?: string;
  favoritedAt: number;
};

export const FAVORITE_SESSIONS_MAX = 50;

// A session outside the active project, surfaced in the Chat Library "Active"
// group. `projectPath` is the server directory used to switch projects; the
// status drives the running indicator and ordering.
export type ActiveSessionItem = {
  connectionScope?: string;
  sessionId: string;
  projectPath: string;
  title?: string;
  status: SessionStatus;
  isCurrent: boolean;
  updatedAt: number;
};

export type ConnectionState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  checkedAt?: number;
  retryableStartup?: boolean;
  kind?: ConnectionFailureKind;
};

// Which diff source the Files Changed surface reads from. `turn` is the
// per-user-message snapshot diff; the VCS scopes come from the project
// working tree and are not tied to the current session.
export type DiffScope = 'turn' | 'uncommitted' | 'branch';

// A selectable user turn that has a recorded snapshot diff.
export type DiffTurn = {
  id: string;
  number: number;
};

export type ProjectCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

// Domain-scoped context values. Consumers subscribe to the narrowest value they
// need (`useProjects()`, `useChat()`, ...) instead of one 130-member surface,
// so unrelated state changes do not re-render every screen.
export type OnboardingContextValue = {
  isHydrated: boolean;
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  completeOnboarding: () => Promise<void>;
  startOnboardingReview: () => void;
  stopOnboardingReview: () => void;
};

// A saved Cloud Link machine the services surface can manage. Services belong
// to one machine, so the selector only appears when more than one exists.
export type ServiceManagementMachine = {
  id: string;
  name: string;
  isActive: boolean;
};

// The machine the services surface currently targets. It can differ from the
// active connection: management uses this machine's own origin and device
// credentials, and links/addresses are built from its `serverUrl`.
export type ServiceManagementTarget = {
  serverUrl: string;
  profileId?: string;
  machineId?: string;
  machineName?: string;
  isActiveConnection: boolean;
};

// Why no usable services surface exists right now.
export type ServiceManagementUnavailableReason = 'no-cloud-link-machine' | 'credentials-expired';

// Remote connector service management. Folded into the connection domain so the
// provider keeps a single context entry for it; consumers read `services` and
// call the actions it exposes. `available` is false while resolving, when no
// Cloud Link machine is saved, or when its credentials expired.
export type ServiceManagementApi = {
  services: ManagedService[];
  // Connector-reported management revision and port pool; undefined until the
  // first refresh answers. `api < 2` (or an unknown older connector) is legacy
  // path-only mode with an update hint instead of the port picker.
  version?: ServiceManagementVersion;
  available: boolean;
  target?: ServiceManagementTarget;
  machines: ServiceManagementMachine[];
  unavailableReason?: ServiceManagementUnavailableReason;
  isRefreshing: boolean;
  isSaving: boolean;
  refresh: () => Promise<void>;
  save: (id: string, input: ServiceInput) => Promise<ManagedService>;
  remove: (id: string) => Promise<void>;
  // Switch the services target machine (saved Cloud Link profiles).
  selectMachine: (id: string) => void;
  // Reconnect the target machine's Cloud Link access; also makes it the active
  // connection because fresh device credentials come from machine access.
  activateTarget: () => Promise<boolean>;
};

export type ConnectionContextValue = {
  connectionProfiles: import('@/providers/use-connection-profiles').ConnectionProfilesState;
  connectSetup: import('@/providers/use-connect-state').ConnectSetup;
  settings: OpencodeConnectionSettings;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
  switchConnection: (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'headers' | 'connect'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => Promise<ConnectionState>;
  connection: ConnectionState;
  serverCapabilities: ServerCapabilities;
  connect: () => Promise<ConnectionState>;
  services: ServiceManagementApi;
};

export type DiagnosticsContextValue = {
  diagnostics?: Diagnostics;
  refreshDiagnostics: () => Promise<void>;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  // Grouped transport state so diagnostics can show why a 4G link feels slow
  // without widening the public context surface one field at a time.
  transport: {
    network: NetworkStatus;
    reconnect: { attempt: number; maxAttempts: number; retryAt?: number };
  };
};

export type CapabilitiesContextValue = {
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  configuredProviders: ProviderOption[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  setProviderAuth: (providerId: string, values: ProviderAuthValues) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  // Grouped so the capabilities context grows one member, not one per action.
  providerOAuth: {
    start: (providerId: string, methodIndex: number, inputs?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    complete: (providerId: string, methodIndex: number, code: string) => Promise<void>;
    completeAutomatic: (providerId: string) => Promise<void>;
    cancel: (providerId: string) => Promise<void>;
  };
  providerAccounts: {
    add: (providerId: string, values: ProviderAuthValues, label?: string) => Promise<void>;
    activate: (credentialId: string) => Promise<void>;
    remove: (credentialId: string) => Promise<void>;
  };
};

export type PreferencesContextValue = {
  chatPreferences: ChatPreferences;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};

export type ProjectsContextValue = {
  projects: OpencodeProject[];
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  selectProject: (path: string) => void;
  addProject: (directory: string) => Promise<string>;
  isRefreshingProjectCatalog: boolean;
  refreshProjectCatalog: (silent?: boolean) => Promise<void>;
  refreshProjectStatus: () => Promise<void>;
};

export type ProjectFilesContextValue = {
  browser: ReturnType<typeof useProjectBrowser>;
  projectFileStatuses: File[];
  // The selected file, its bytes for inline media preview, and every file
  // action share one member so the public context surface stays bounded.
  projectFile: {
    selected?: ProjectFile;
    open: (path: string) => Promise<void>;
    save: (path: string, expectedContent: string, content: string) => Promise<void>;
    close: () => void;
    download: (path: string, signal?: AbortSignal) => Promise<void>;
  };
  vcsInfo?: VcsInfo;
  worktrees: WorktreeCatalog;
  refreshWorktrees: () => Promise<void>;
  createWorktree: (name?: string) => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
};

export type CurrentSessionContextValue = {
  currentSessionId?: string;
  activeSession?: Session;
  // Grouped so the connection-wide snapshot, its refresh, and the
  // library-visibility signal for polling share one context member.
  activeSessions: {
    list: ActiveSessionItem[];
    refresh: () => Promise<void>;
    setVisible: (visible: boolean) => void;
  };
  ensureActiveSession: () => Promise<string | undefined>;
  openDeepLinkSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
  openSession: (sessionId: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
};

export type SessionLibraryContextValue = {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  favoriteSessions: FavoriteSession[];
  toggleFavoriteSession: (sessionId: string, projectPath: string, title?: string) => void;
  isFavoriteSession: (sessionId: string) => boolean;
  clearFavoriteSession: (sessionId: string) => void;
  sessionPreviewById: Record<string, string>;
  refreshSessions: () => Promise<Session[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, messageId?: string) => Promise<Session>;
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (sessionId: string) => Promise<void>;
  openSessionInProject: (projectPath: string, sessionId: string, connectionScope?: string) => Promise<void>;
};

export type ChatContextValue = {
  pendingPrompts: PendingPrompt[];
  cancelPrompt: (sessionId: string, promptId: string) => Promise<void>;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  currentUsage: SessionUsage;
  latestAssistantTurnUsage?: SessionUsage;
  currentDiffs: FileDiff[];
  currentDiffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;
  diffTurns: DiffTurn[];
  selectedDiffMessageId?: string;
  selectDiffMessage: (messageId: string) => void;
  refreshDiffs: (silent?: boolean) => Promise<void>;
  currentTodos: Todo[];
  currentPendingPermissions: PendingPermission[];
  currentPendingQuestions: PendingQuestion[];
  isRefreshingMessages: boolean;
  transcriptReadError?: string;
  retryTranscript: () => Promise<void>;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  // Grouped so the domain context surface does not grow one member per paging
  // concern.
  transcriptPaging: {
    loadOlder: (sessionId: string) => Promise<void>;
    hasOlder: boolean;
    isLoadingOlder: boolean;
  };
  replyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  commands: Command[];
  executeCommand: (sessionId: string, command: string, args: string) => Promise<void>;
  sendPrompt: (sessionId: string, prompt: string, attachments?: { uri: string; mime?: string; filename?: string }[]) => Promise<boolean>;
  abortSession: (sessionId: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: {
    sessionId?: string;
    active: boolean;
  };
  promptError?: { message: string; occurredAt: number; sessionId?: string; sourceTitle?: string };
  clearPromptError: () => void;
  // Content shared into the app from the OS share sheet, grouped so the context
  // surface does not grow one member per share concern.
  sharedInput: SharedInput;
};

// Server-originated approval interactions grouped so the domain surface does
// not grow one member per concern. Kept out of ChatContext so approval
// consumers do not re-render on every transcript update.
export type ApprovalsContextValue = {
  approvals: {
    mcpAuth?: { mcpName: string; url: string };
    dismissMcpAuth: () => void;
    savedPermissions: SavedPermissionRule[];
    refreshSavedPermissions: () => Promise<void>;
    removeSavedPermission: (id: string) => Promise<void>;
  };
};

export type ConversationContextValue = {
  conversation: ConversationState;
  clearConversationFeedback: () => void;
  toggleConversationMode: () => Promise<void>;
};

export type TerminalContextValue = {
  terminals: Pty[];
  activeTerminalId?: string;
  terminalRuntime: TerminalRuntime;
  terminalConnection: TerminalStatus;
  refreshTerminals: () => Promise<void>;
  createTerminal: () => Promise<Pty>;
  openTerminal: (ptyId: string) => Promise<void>;
  sendTerminalInput: (ptyId: string, input: string, generation: number, scope: number) => void;
  closeTerminal: (ptyId: string) => Promise<void>;
};

export type McpContextValue = {
  mcpStatuses: Record<string, McpStatus>;
  refreshMcpServers: () => Promise<void>;
  addMcpServer: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  connectMcpServer: (name: string) => Promise<void>;
  disconnectMcpServer: (name: string) => Promise<void>;
  mcpOAuth: {
    methods: (name: string) => Promise<ProviderAuthMethod[]>;
    start: (name: string, method: number, values?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    complete: (name: string, code: string) => Promise<void>;
    wait: (name: string) => Promise<void>;
    cancel: (name: string) => Promise<void>;
  };
};

export type UpdatesContextValue = ReturnType<typeof import('@/providers/use-app-updates').useAppUpdates>;
