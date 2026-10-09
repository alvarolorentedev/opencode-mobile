import type { useWorkspaceBrowser } from '@/providers/use-workspace-browser';
import type { WorktreeCatalog } from '@/providers/use-worktree-state';
import type { PendingPrompt } from '@/lib/opencode/prompt-inbox';
import type {
  Command,
  Config,
  File,
  FileContent,
  FileDiff,
  GlobalSession,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Project,
  ProviderAuthMethod,
  Pty,
  PtyShellsResponse,
  ProviderAuthValues,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from '@/lib/opencode/types';
import type {
  OpencodeConnectionSettings,
  PendingPermission,
  PendingQuestion,
  PendingQuestionAnswer,
  PendingQuestionRequest,
  PendingPermissionRequest,
  SavedPermissionRule,
} from '@/lib/opencode/client';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { SessionMessageRecord, TranscriptEntry } from '@/lib/opencode/format';
import type { SessionUsage } from '@/lib/opencode/usage';
import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ChatPreferences, ReasoningLevel, ResponseScope } from '@/providers/opencode-preferences';
import type { ServerCapabilities } from '@/providers/opencode-capabilities';
import type { TerminalRuntime, TerminalStatus } from '@/providers/terminal-types';

export type { AgentOption, ChatPreferences, ModelOption, ReasoningLevel, ResponseScope, ServerCapabilities };
export type { ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues } from '@/lib/opencode/types';

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
  modelCount: number;
  configured: boolean;
  // Integrations that serve this provider's login methods (its own id plus any
  // linked Console integration). Used to associate stored accounts.
  integrationIds?: string[];
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
  source: 'server';
  updatedAt?: number;
  isCurrent?: boolean;
};

// Explicit persisted model for a pinned session. `sessionId` and `projectPath`
// are the identifiers required to reopen it; `connectionScope` says which
// server + user owns it, so identical paths or session IDs on another server
// never collide. `title` is retained because it cannot be reconstructed for
// cross-workspace favorites without a server call. The project label is
// derived from `projectPath` at render time and is never persisted.
export type FavoriteSession = {
  sessionId: string;
  connectionScope: string;
  projectPath: string;
  title?: string;
  favoritedAt: number;
};

export const FAVORITE_SESSIONS_MAX = 50;

// A session outside the active workspace, surfaced in the Chat Library "Active"
// group. `projectPath` is the server directory used to switch workspaces; the
// status drives the running indicator and ordering.
export type ActiveSessionItem = {
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
  projectDirectory?: string;
};

// Which diff source the Files Changed surface reads from. `turn` is the
// per-user-message snapshot diff; the VCS scopes come from the workspace
// working tree and are not tied to the current session.
export type DiffScope = 'turn' | 'uncommitted' | 'branch';

// A selectable user turn that has a recorded snapshot diff.
export type DiffTurn = {
  id: string;
  label: string;
  preview?: string;
};

export type WorkspaceCatalog = {
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

export type ConnectionContextValue = {
  connectionProfiles: import('@/providers/use-connection-profiles').ConnectionProfilesState;
  connectSetup: import('@/providers/use-connect-state').ConnectSetup;
  settings: OpencodeConnectionSettings;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
  switchConnection: (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'connect'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => Promise<ConnectionState>;
  connection: ConnectionState;
  serverCapabilities: ServerCapabilities;
  connect: () => Promise<ConnectionState>;
};

export type DiagnosticsContextValue = {
  diagnostics?: Diagnostics;
  refreshDiagnostics: () => Promise<void>;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
};

export type CapabilitiesContextValue = {
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  configuredProviders: ProviderOption[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  configureProvider: (providerId: string) => Promise<void>;
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
  addWorkspace: (directory: string) => Promise<string>;
  serverProjects: Project[];
  currentProjectPath?: string;
  serverRootPath?: string;
  isRefreshingWorkspaceCatalog: boolean;
  refreshWorkspaceCatalog: (silent?: boolean) => Promise<void>;
  refreshWorkspaceStatus: () => Promise<void>;
};

export type WorkspaceFilesContextValue = {
  browser: ReturnType<typeof useWorkspaceBrowser>;
  workspaceFileStatuses: File[];
  selectedWorkspaceFile?: { path: string; content: FileContent };
  vcsInfo?: VcsInfo;
  openWorkspaceFile: (path: string) => Promise<void>;
  saveWorkspaceFile: (path: string, expectedContent: string, content: string) => Promise<void>;
  worktrees: WorktreeCatalog;
  refreshWorktrees: () => Promise<void>;
  createWorktree: (name?: string, startCommand?: string) => Promise<void>;
  resetWorktree: (directory: string) => Promise<void>;
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
  archivedSessions: GlobalSession[];
  sessionStatuses: Record<string, SessionStatus>;
  favoriteSessions: FavoriteSession[];
  toggleFavoriteSession: (sessionId: string, projectPath: string, title?: string) => void;
  isFavoriteSession: (sessionId: string) => boolean;
  clearFavoriteSession: (sessionId: string) => void;
  sessionPreviewById: Record<string, string>;
  isRefreshingSessions: boolean;
  refreshSessions: (silent?: boolean) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  restoreSession: (sessionId: string, options?: { projectPath?: string; open?: boolean }) => Promise<void>;
  refreshArchivedSessions: () => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, messageId?: string) => Promise<Session>;
  shareSession: (sessionId: string) => Promise<Session>;
  unshareSession: (sessionId: string) => Promise<Session>;
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (sessionId: string) => Promise<void>;
  openSessionInProject: (projectPath: string, sessionId: string, connectionScope?: string) => Promise<void>;
};

export type ChatContextValue = {
  pendingPrompts: PendingPrompt[];
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
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  // Grouped so the domain context surface does not grow one member per paging
  // concern.
  transcriptPaging: {
    loadOlder: (sessionId: string) => Promise<void>;
    hasOlder: boolean;
    isLoadingOlder: boolean;
  };
  refreshCurrentSession: (silent?: boolean) => Promise<void>;
  refreshCurrentTodos: (silent?: boolean) => Promise<void>;
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
  terminalShells: PtyShellsResponse;
  activeTerminalId?: string;
  terminalRuntime: TerminalRuntime;
  terminalConnection: TerminalStatus;
  refreshTerminals: () => Promise<void>;
  createTerminal: (command?: string, title?: string) => Promise<Pty>;
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
  setMcpServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  startMcpOAuth: (name: string) => Promise<string>;
  completeMcpOAuth: (name: string, code: string) => Promise<void>;
};

// The union of every domain, kept for documentation and the architecture
// ratchet. No runtime context exposes this shape.
export type UpdatesContextValue = ReturnType<typeof import('@/providers/use-app-updates').useAppUpdates>;

export type OpencodeContextValue = OnboardingContextValue &
  ConnectionContextValue &
  DiagnosticsContextValue &
  CapabilitiesContextValue &
  PreferencesContextValue &
  ProjectsContextValue &
  WorkspaceFilesContextValue &
  CurrentSessionContextValue &
  SessionLibraryContextValue &
  ChatContextValue &
  ApprovalsContextValue &
  ConversationContextValue &
  TerminalContextValue &
  McpContextValue & UpdatesContextValue;
