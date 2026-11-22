import { createStore, type StoreApi } from 'zustand/vanilla';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import type { PendingPrompt, PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { FavoriteSession, HiddenProjectsByConnection } from '@/shared/contracts/domain';
import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';
import type { ConversationInputPhase, ConversationReadbackPhase } from '@/features/voice/index';
import type { TerminalInstance } from '@/features/terminal/index';
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
};

export type RegistryState = {
  connections: ConnectionRecord[];
  focus?: WorkspaceTarget;
  retainedFocus?: WorkspaceTarget;
  ready: boolean;
  snapshots: Record<string, WorkspaceSnapshot>;
};

export type SelectionState = {
  activeProjectPath?: string;
  currentSessionId?: string;
  isBootstrappingChat: boolean;
  activeSessionsVisible: boolean;
};

export type ChatUiState = {
  diffScopeBySession: Record<string, import('@/shared/contracts/domain').DiffScope>;
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
  readbackPhase: ConversationReadbackPhase;
  turnSequence: number;
  sessionId?: string;
  queuedPrompt?: string;
  pendingTurn?: string;
  feedback?: string;
  feedbackAction: VoiceRecoveryAction;
  latestHeardText?: string;
  wakeSensor: 'phrase' | 'local';
};

const EMPTY_CONVERSATION: ConversationRuntimeState = {
  phase: 'off',
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

const EMPTY_CHAT: ChatUiState = {
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
  selection: Record<string, SelectionState>;
  chat: Record<string, ChatUiState>;
  prompt: Record<string, PromptUiState>;
  conversation: Record<string, ConversationRuntimeState | undefined>;
  terminal: Record<string, TerminalDeviceState | undefined>;
  presentation: Map<string, unknown>;
  mcpAuthPrompt?: { mcpName: string; url: string };
  focusedValues?: import('@/runtime/workspace/workspace-types').WorkspaceValues;
  setFocusedValues: (values: import('@/runtime/workspace/workspace-types').WorkspaceValues | undefined) => void;
  setMcpAuthPrompt: (value: { mcpName: string; url: string } | undefined | ((current: { mcpName: string; url: string } | undefined) => { mcpName: string; url: string } | undefined)) => void;
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
};

export type AppStore = StoreApi<AppState>;

export type AppStoreDefaults = Pick<ShellState, 'settings' | 'chatPreferences' | 'controlPlaneUrl'>;

export function createAppStore(defaults: AppStoreDefaults): AppStore {
  return createStore<AppState>()((set) => ({
    shell: {
      ...defaults,
      onboardingVersion: 0,
      onboardingActive: false,
      favoriteSessions: [],
      hiddenProjects: {},
    },
    registry: { connections: [], ready: false, snapshots: {} },
    selection: {},
    chat: {},
    prompt: {},
    conversation: {},
    terminal: {},
    mcpAuthPrompt: undefined,
    // Mutated in place; the hook only needs the stable map identity.
    presentation: new Map<string, unknown>(),
    focusedValues: undefined,
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
    setFocusedValues: (values) => set({ focusedValues: values }),
    setMcpAuthPrompt: (value) => set((state) => ({
      mcpAuthPrompt: typeof value === 'function' ? value(state.mcpAuthPrompt) : value,
    })),
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
  }));
}
