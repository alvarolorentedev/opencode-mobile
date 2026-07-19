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
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
  Worktree,
} from '@/lib/opencode/types';
import type {
  OpencodeConnectionSettings,
  PendingQuestionAnswer,
  PendingQuestionRequest,
  PendingPermissionRequest,
} from '@/lib/opencode/client';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { SessionMessageRecord, TranscriptEntry } from '@/lib/opencode/format';
import type { SessionUsage } from '@/lib/opencode/usage';
import type {
  AgentOption as ProviderAgentOption,
  ChatPreferences as ProviderChatPreferences,
  ModelOption as ProviderModelOption,
  ReasoningLevel as ProviderReasoningLevel,
  ResponseScope as ProviderResponseScope,
} from '@/providers/opencode-provider-utils';

export type AgentOption = ProviderAgentOption;
export type ChatPreferences = ProviderChatPreferences;
export type ModelOption = ProviderModelOption;
export type ReasoningLevel = ProviderReasoningLevel;
export type ResponseScope = ProviderResponseScope;
export type { ProviderAuthMethod } from '@/lib/opencode/types';

export type ProviderOption = {
  id: string;
  label: string;
  modelCount: number;
  configured: boolean;
};

export type ConversationPhase = 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';

export const CONVERSATION_KEEP_AWAKE_TAG = 'opencode-conversation-mode';
export const CONVERSATION_FINAL_RESULT_SETTLE_MS = 2200;
export const CONVERSATION_LISTENING_RESTART_MS = 350;

export type ConversationState = {
  active: boolean;
  sessionId?: string;
  phase: ConversationPhase;
  statusLabel?: string;
  feedback?: string;
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

export type ConnectionState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  checkedAt?: number;
  projectDirectory?: string;
};

export type WorkspaceCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

export type OpencodeContextValue = {
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
  refreshWorkspaceStatus: () => Promise<void>;
  sessions: Session[];
  archivedSessions: GlobalSession[];
  sessionStatuses: Record<string, SessionStatus>;
  currentSessionId?: string;
  activeSession?: Session;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  currentUsage: SessionUsage;
  latestAssistantTurnUsage?: SessionUsage;
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
  completeAutomaticProviderOAuth: (providerId: string) => Promise<void>;
  setProviderAuth: (providerId: string, values: Record<string, string>) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  startProviderOAuth: (providerId: string, methodIndex: number, inputs?: Record<string, string>) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
  completeProviderOAuth: (providerId: string, methodIndex: number, code: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: {
    sessionId?: string;
    active: boolean;
  };
  promptError?: { message: string; occurredAt: number; sessionId?: string };
  clearPromptError: () => void;
  connect: () => Promise<void>;
  refreshSessions: (silent?: boolean) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  refreshCurrentSession: (silent?: boolean) => Promise<void>;
  refreshCurrentTodos: (silent?: boolean) => Promise<void>;
  ensureActiveSession: () => Promise<string | undefined>;
  createSession: (title?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  restoreSession: (sessionId: string) => Promise<void>;
  refreshArchivedSessions: () => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, messageId?: string) => Promise<Session>;
  shareSession: (sessionId: string) => Promise<Session>;
  unshareSession: (sessionId: string) => Promise<Session>;
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (sessionId: string) => Promise<void>;
  sendPrompt: (sessionId: string, prompt: string, attachments?: { uri: string; mime?: string; filename?: string }[]) => Promise<boolean>;
  abortSession: (sessionId: string) => Promise<void>;
  replyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  commands: Command[];
  executeCommand: (sessionId: string, command: string, args: string) => Promise<void>;
  workspaceFiles: string[];
  workspaceFileStatuses: File[];
  selectedWorkspaceFile?: { path: string; content: FileContent };
  vcsInfo?: VcsInfo;
  searchWorkspaceFiles: (query: string) => Promise<void>;
  openWorkspaceFile: (path: string) => Promise<void>;
  saveWorkspaceFile: (path: string, expectedContent: string, content: string) => Promise<void>;
  worktrees: (string | Worktree)[];
  refreshWorktrees: () => Promise<void>;
  createWorktree: (name?: string, startCommand?: string) => Promise<void>;
  resetWorktree: (directory: string) => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
  mcpStatuses: Record<string, McpStatus>;
  refreshMcpServers: () => Promise<void>;
  addMcpServer: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  connectMcpServer: (name: string) => Promise<void>;
  disconnectMcpServer: (name: string) => Promise<void>;
  setMcpServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  startMcpOAuth: (name: string) => Promise<string>;
  completeMcpOAuth: (name: string, code: string) => Promise<void>;
  terminals: Pty[];
  terminalShells: PtyShellsResponse;
  activeTerminalId?: string;
  terminalOutput: string;
  terminalConnection: 'idle' | 'connecting' | 'connected' | 'error';
  refreshTerminals: () => Promise<void>;
  createTerminal: (command?: string, title?: string) => Promise<Pty>;
  openTerminal: (ptyId: string) => Promise<void>;
  sendTerminalInput: (input: string) => void;
  closeTerminal: (ptyId: string) => Promise<void>;
  diagnostics?: Diagnostics;
  refreshDiagnostics: () => Promise<void>;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
};
