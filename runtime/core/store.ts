import { persist, type PersistOptions } from 'zustand/middleware';
import { createStore, type Mutate, type StateCreator, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_NETWORK_STATUS, type NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import type { PendingPrompt, PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { FavoriteSession, SessionDeepLinkTarget } from '@/features/sessions/index';
import type { DiffScope, HiddenProjectsByConnection } from '@/features/projects/index';
import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { ConversationInputPhase, ConversationReadbackPhase } from '@/features/voice/index';
import type { PendingConfirmation } from '@/features/voice/runtime';
import type { FileClipboardEntry } from '@/features/projects/runtime';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { TerminalInstance } from '@/features/terminal/index';
import type { LiveTranscriptBuffer } from '@/features/chat/runtime';
import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';

// Device-local state only. Server facts belong to TanStack Query; anything in
// this store is a user or device decision. See docs/architecture/state-and-data.md.
export type ShellState = {
  settings: OpencodeConnectionSettings;
  controlPlaneUrl: string;
  onboardingVersion: number;
  onboardingActive: boolean;
  chatPreferences: ChatPreferences;
  favoriteSessions: FavoriteSession[];
  hiddenProjects: HiddenProjectsByConnection;
  profiles: ConnectionProfile[];
};

export type RegistryState = {
  connections: ConnectionRecord[];
  focus?: WorkspaceTarget;
  terminalTarget?: WorkspaceTarget;
  inspectionTarget?: WorkspaceTarget;
  lastHealthyConnectionId?: string;
  previousHealthyConnectionId?: string;
  ready: boolean;
};

export type SelectionState = {
  activeProjectPath?: string;
  currentSessionId?: string;
  isBootstrappingChat: boolean;
  activeSessionsVisible: boolean;
  explicitSessionId?: string;
  pendingDeepLink?: SessionDeepLinkTarget;
};

type McpAuthPrompt = { mcpName: string; url: string; scopeKey: string; queryKey: readonly unknown[] };

export type ChatUiState = {
  diffScopeBySession: Record<string, DiffScope>;
  selectedDiffMessageBySession: Record<string, string | undefined>;
  isRefreshingMessages: boolean;
  isRefreshingDiffs: boolean;
  readErrors: Record<string, string>;
};

export type PromptUiState = {
  sending: { sessionId?: string; active: boolean };
  error?: { message: string; occurredAt: number; sessionId?: string };
  outbox?: PromptOutbox;
};

export type PromptOutbox = {
  sequence: number;
  bySession: Record<string, { prompt: PendingPrompt; queued?: { input: PromptInput; sequence: number } }[]>;
};

type ConversationRuntimeState = {
  phase: ConversationInputPhase;
  level: number;
  readbackPhase: ConversationReadbackPhase;
  turnSequence: number;
  sessionId?: string;
  queuedPrompt?: string;
  pendingTurn?: string;
  feedback?: string;
  feedbackAction: VoiceRecoveryAction;
  latestHeardText?: string;
  wakeSensor: 'phrase' | 'local';
  confirmation?: PendingConfirmation;
  confirmationSpeaking?: boolean;
  readbackQueue?: string[];
};

const EMPTY_CONVERSATION: ConversationRuntimeState = {
  phase: 'off',
  level: 0,
  readbackPhase: 'idle',
  turnSequence: 0,
  feedbackAction: 'none',
  wakeSensor: 'phrase',
};

type TerminalDeviceState = {
  activeTerminalId?: string;
  instances: TerminalInstance[];
  scope: number;
};

const EMPTY_TERMINAL: TerminalDeviceState = { instances: [], scope: 0 };

type TranscriptUiState = {
  loadingOlderBySession: Record<string, boolean>;
  hydratingSessionIds: Record<string, boolean>;
  paintRevision: number;
};

const EMPTY_TRANSCRIPT_UI: TranscriptUiState = { loadingOlderBySession: {}, hydratingSessionIds: {}, paintRevision: 0 };

type WorkspaceUiState = {
  extensionsRequested?: boolean;
  extensionMutation?: { name: string };
  extensionError?: string;
  selectedPluginId?: string;
  mcpRequested?: boolean;
  browser?: { owner: symbol; path: string; query?: string };
  preview?: { owner: symbol; path: string; request: symbol };
  diagnosticsRequested?: boolean;
  classifierProbe?: {
    owner: string;
    request?: symbol;
    model?: { providerId: string; modelId: string };
    status?: 'checking' | 'unsupported' | 'unavailable';
  };
  entryOperationsOwner?: symbol;
  entryOperationFeedback?: { owner: symbol; error?: string; notice?: string };
};

type FileClipboardState = {
  entries: Record<string, FileClipboardEntry | undefined>;
  busy: Record<string, boolean>;
};

export const EMPTY_CHAT: ChatUiState = {
  diffScopeBySession: {},
  selectedDiffMessageBySession: {},
  isRefreshingMessages: false,
  isRefreshingDiffs: false,
  readErrors: {},
};

const EMPTY_PROMPT: PromptUiState = { sending: { active: false } };

const EMPTY_SELECTION: SelectionState = {
  activeProjectPath: undefined,
  currentSessionId: undefined,
  isBootstrappingChat: false,
  activeSessionsVisible: false,
};

export type AppState = {
  shell: ShellState;
  registry: RegistryState;
  network: NetworkStatus;
  setNetwork: (network: NetworkStatus) => void;
  selection: Record<string, SelectionState>;
  chat: Record<string, ChatUiState>;
  prompt: Record<string, PromptUiState>;
  conversation: Record<string, ConversationRuntimeState | undefined>;
  terminal: Record<string, TerminalDeviceState | undefined>;
  transcriptUi: Record<string, TranscriptUiState | undefined>;
  transcriptLive: Map<string, LiveTranscriptBuffer>;
  workspaceUi: Record<string, WorkspaceUiState | undefined>;
  localClassifierReady?: boolean;
  fileClipboard: FileClipboardState;
  presentation: Map<string, unknown>;
  mcpAuthPrompt?: McpAuthPrompt;
  setMcpAuthPrompt: (value: McpAuthPrompt | undefined | ((current: McpAuthPrompt | undefined) => McpAuthPrompt | undefined)) => void;
  setShellValue: <K extends keyof ShellState>(
    key: K,
    value: ShellState[K] | ((current: ShellState[K]) => ShellState[K]),
  ) => void;
  setRegistry: (patch: Partial<RegistryState> | ((current: RegistryState) => Partial<RegistryState>)) => void;
  setSelection: (scopeKey: string, patch: Partial<SelectionState> | ((current: SelectionState) => Partial<SelectionState>)) => void;
  setChat: (scopeKey: string, patch: Partial<ChatUiState> | ((current: ChatUiState) => Partial<ChatUiState>)) => void;
  setPrompt: (scopeKey: string, patch: Partial<PromptUiState> | ((current: PromptUiState) => Partial<PromptUiState>)) => void;
  clearPromptOutboxes: (connectionId: string) => void;
  setConversationValue: <K extends keyof ConversationRuntimeState>(scopeKey: string, key: K,
    change: ConversationRuntimeState[K] | ((current: ConversationRuntimeState[K]) => ConversationRuntimeState[K]),
  ) => void;
  clearConversation: (scopeKey: string) => void;
  setTerminalState: (scopeKey: string, patch: Partial<TerminalDeviceState> | ((current: TerminalDeviceState) => Partial<TerminalDeviceState>)) => void;
  setTranscriptUi: (scopeKey: string, patch: Partial<TranscriptUiState> | ((current: TranscriptUiState) => Partial<TranscriptUiState>)) => void;
  setWorkspaceUi: (scopeKey: string, patch: Partial<WorkspaceUiState>) => void;
  clearWorkspaceUi: (connectionId: string) => void;
  setLocalClassifierReady: (ready: boolean) => void;
  setFileClipboard: (patch: (current: FileClipboardState) => Partial<FileClipboardState>) => void;
};

export type AppStore = StoreApi<AppState>;

export type AppStoreDefaults = Pick<ShellState, 'settings' | 'chatPreferences' | 'controlPlaneUrl'>;

export function createAppStore(defaults: AppStoreDefaults): AppStore;
export function createAppStore<T>(defaults: AppStoreDefaults, options: PersistOptions<AppState, T>): Mutate<AppStore, [['zustand/persist', T]]>;
export function createAppStore<T>(defaults: AppStoreDefaults, options?: PersistOptions<AppState, T>) {
  const initialize: StateCreator<AppState> = (set) => ({
    shell: {
      ...defaults,
      onboardingVersion: 0,
      onboardingActive: false,
      favoriteSessions: [],
      hiddenProjects: {},
      profiles: [],
    },
    registry: { connections: [], ready: false },
    network: DEFAULT_NETWORK_STATUS,
    setNetwork: (network) => set({ network }),
    selection: {},
    chat: {},
    prompt: {},
    conversation: {},
    terminal: {},
    transcriptUi: {},
    transcriptLive: new Map(),
    workspaceUi: {},
    fileClipboard: { entries: {}, busy: {} },
    mcpAuthPrompt: undefined,
    // Mutated in place; the hook only needs the stable map identity.
    presentation: new Map<string, unknown>(),
    setShellValue: (key, value) => set((state) => ({
      shell: {
        ...state.shell,
        [key]: typeof value === 'function'
          ? (value as (current: ShellState[typeof key]) => ShellState[typeof key])(state.shell[key])
          : value,
      },
    })),
    setRegistry: (patch) => set((state) => ({
      registry: { ...state.registry, ...(typeof patch === 'function' ? patch(state.registry) : patch) },
    })),
    setSelection: (scopeKey, patch) => set((state) => {
      const current = state.selection[scopeKey] ?? EMPTY_SELECTION;
      return {
        selection: {
          ...state.selection,
          [scopeKey]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) },
        },
      };
    }),
    setMcpAuthPrompt: (value) => set((state) => {
      const next = typeof value === 'function' ? value(state.mcpAuthPrompt) : value;
      return next === state.mcpAuthPrompt ? state : { mcpAuthPrompt: next };
    }),
    setChat: (scopeKey, patch) => set((state) => {
      const current = state.chat[scopeKey] ?? EMPTY_CHAT;
      return {
        chat: {
          ...state.chat,
          [scopeKey]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) },
        },
      };
    }),
    setPrompt: (scopeKey, patch) => set((state) => {
      const current = state.prompt[scopeKey] ?? EMPTY_PROMPT;
      return {
        prompt: {
          ...state.prompt,
          [scopeKey]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) },
        },
      };
    }),
    clearPromptOutboxes: (connectionId) => set((state) => ({
      prompt: Object.fromEntries(Object.entries(state.prompt).map(([key, value]) => [key,
        value.outbox && (JSON.parse(key) as string[])[0] === connectionId
          ? { ...value, outbox: { sequence: value.outbox.sequence, bySession: {} } } : value,
      ])),
    })),
    setConversationValue: (scopeKey, key, change) => set((state) => {
      const current = state.conversation[scopeKey] ?? EMPTY_CONVERSATION;
      const value = typeof change === 'function' ? change(current[key]) : change;
      if (Object.is(current[key], value)) return state;
      return { conversation: { ...state.conversation, [scopeKey]: { ...current, [key]: value } } };
    }),
    clearConversation: (scopeKey) => set((state) => {
      if (!state.conversation[scopeKey]) return state;
      const conversation = { ...state.conversation };
      delete conversation[scopeKey];
      return { conversation };
    }),
    setTerminalState: (scopeKey, patch) => set((state) => {
      const current = state.terminal[scopeKey] ?? EMPTY_TERMINAL;
      const value = typeof patch === 'function' ? patch(current) : patch;
      return { terminal: { ...state.terminal, [scopeKey]: { ...current, ...value } } };
    }),
    setTranscriptUi: (scopeKey, patch) => set((state) => {
      const current = state.transcriptUi[scopeKey] ?? EMPTY_TRANSCRIPT_UI;
      const value = typeof patch === 'function' ? patch(current) : patch;
      return { transcriptUi: { ...state.transcriptUi, [scopeKey]: { ...current, ...value } } };
    }),
    setWorkspaceUi: (scopeKey, patch) => set((state) => {
      const current = state.workspaceUi[scopeKey];
      if (Object.entries(patch).every(([key, value]) => current?.[key as keyof WorkspaceUiState] === value)) return state;
      return { workspaceUi: { ...state.workspaceUi, [scopeKey]: { ...current, ...patch } } };
    }),
    clearWorkspaceUi: (connectionId) => set((state) => ({
      workspaceUi: Object.fromEntries(Object.entries(state.workspaceUi).filter(([key]) => (JSON.parse(key) as string[])[0] !== connectionId)),
      ...(state.mcpAuthPrompt && (JSON.parse(state.mcpAuthPrompt.scopeKey) as string[])[0] === connectionId ? { mcpAuthPrompt: undefined } : {}),
    })),
    setLocalClassifierReady: (ready) => set((state) => state.localClassifierReady === ready ? state : { localClassifierReady: ready }),
    setFileClipboard: (patch) => set((state) => ({ fileClipboard: { ...state.fileClipboard, ...patch(state.fileClipboard) } })),
  });
  return options ? createStore<AppState>()(persist(initialize, options)) : createStore<AppState>()(initialize);
}
