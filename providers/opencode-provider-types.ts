import type { Config, FileDiff, Project, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import type {
  OpencodeConnectionSettings,
  PendingPermissionRequest,
  PendingQuestionAnswer,
  PendingQuestionRequest,
} from '@/lib/opencode/client';
import type { SessionMessageRecord, TranscriptEntry } from '@/lib/opencode/format';
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
  options?: {
    label: string;
    value: string;
    hint?: string;
  }[];
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
