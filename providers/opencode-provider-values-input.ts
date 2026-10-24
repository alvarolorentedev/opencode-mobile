import type { WorktreeCatalog } from '@/providers/use-worktree-state';
import type { TerminalRuntime, TerminalStatus } from './terminal-types';
import type { PendingPrompt } from '@/lib/opencode/prompt-inbox';
import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest, SavedPermissionRule, ServerContract, OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { ProjectFile } from '@/lib/opencode/project-file';
import type { SessionUsageStep } from '@/lib/opencode/usage';
import type {
  Config,
  Command,
  File,
  FileDiff,
  GlobalSession,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Pty,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from '@/lib/opencode/types';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type {
  ActiveSessionItem,
  ConnectionState,
  DiffScope,
  FavoriteSession,
  OpencodeProject,
  ProviderAuthMethod,
  ProviderOption,
} from '@/providers/opencode-provider-types';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { NetworkStatus } from '@/lib/network-status';
import type { useCapabilitiesActions } from '@/providers/use-capabilities-actions';
import type { useConnectionActions } from '@/providers/use-connection-actions';
import type { useConversationState } from '@/providers/use-conversation-state';
import type { usePromptLifecycle } from '@/providers/use-prompt-lifecycle';
import type { useSessionActions } from '@/providers/use-session-actions';
import type { useProjectActions } from '@/providers/use-project-actions';
import type { SharedInput } from '@/providers/use-share-state';

type ActionInputs =
  ReturnType<typeof useProjectActions> &
  ReturnType<typeof useSessionActions> &
  ReturnType<typeof useCapabilitiesActions> &
  ReturnType<typeof usePromptLifecycle> &
  ReturnType<typeof useConnectionActions> &
  ReturnType<typeof useConversationState>;

export type ProviderValuesInput = ActionInputs & {
  isHydrated: boolean;
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  completeOnboarding: () => Promise<void>;
  startOnboardingReview: () => void;
  stopOnboardingReview: () => void;
  settings: OpencodeConnectionSettings;
  connection: ConnectionState;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  network: NetworkStatus;
  reconnect: { attempt: number; maxAttempts: number; retryAt?: number };
  diagnostics?: Diagnostics;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  projects: OpencodeProject[];
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  isRefreshingProjectCatalog: boolean;
  projectFileStatuses: File[];
  selectedProjectFile?: ProjectFile;
  vcsInfo?: VcsInfo;
  worktrees: WorktreeCatalog;
  refreshWorktrees: () => Promise<void>;
  createWorktree: (name?: string, startCommand?: string) => Promise<void>;
  resetWorktree: (directory: string) => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
  sessions: Session[];
  archivedSessions: GlobalSession[];
  sessionStatuses: Record<string, SessionStatus>;
  favoriteSessions: FavoriteSession[];
  activeSessions: ActiveSessionItem[];
  refreshActiveSessions: () => Promise<void>;
  setActiveSessionsVisible: Dispatch<SetStateAction<boolean>>;
  currentSessionId?: string;
  pendingPromptsBySession: Record<string, PendingPrompt[]>;
  cancelPrompt: (sessionId: string, promptId: string) => Promise<void>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  diffScopeBySession: Record<string, DiffScope>;
  diffsBySession: Record<string, FileDiff[]>;
  vcsDiffsByScope: Record<'uncommitted' | 'branch', FileDiff[]>;
  selectedDiffMessageBySession: Record<string, string | undefined>;
  todosBySession: Record<string, Todo[]>;
  todoRecordsBySession: Record<string, SessionMessageRecord[]>;
  usageStepsBySession: Record<string, SessionUsageStep[]>;
  messageWindows: Record<string, { nextBefore?: string; hasMore: boolean }>;
  loadingOlderBySession: Record<string, boolean>;
  hydratingSessionIds: Record<string, boolean>;
  loadOlderMessages: (sessionId: string) => Promise<void>;
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  mcpAuthPrompt?: { mcpName: string; url: string };
  dismissMcpAuth: () => void;
  savedPermissions: SavedPermissionRule[];
  refreshSavedPermissions: () => Promise<void>;
  removeSavedPermission: (id: string) => Promise<void>;
  sendingState: { sessionId?: string; active: boolean };
  isRefreshingMessages: boolean;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  commands: Command[];
  serverContract: ServerContract;
  terminals: Pty[];
  activeTerminalId?: string;
  terminalRuntime: TerminalRuntime;
  terminalConnection: TerminalStatus;
  refreshTerminals: () => Promise<void>;
  createTerminal: () => Promise<Pty>;
  openTerminal: (ptyId: string) => Promise<void>;
  sendTerminalInput: (ptyId: string, input: string, generation: number, scope: number) => void;
  closeTerminal: (ptyId: string) => Promise<void>;
  mcpStatuses: Record<string, McpStatus>;
  refreshMcpServers: () => Promise<void>;
  addMcpServer: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  connectMcpServer: (name: string) => Promise<void>;
  disconnectMcpServer: (name: string) => Promise<void>;
  setMcpServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  mcpOAuth: import('./opencode-provider-types').McpContextValue['mcpOAuth'];
  sharedInput: SharedInput;
};
