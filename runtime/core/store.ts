import { createStore, type StoreApi } from 'zustand/vanilla';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { FavoriteSession, HiddenProjectsByConnection } from '@/shared/contracts/domain';
import type { ConnectionRecord, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';

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
};

const EMPTY_CHAT: ChatUiState = {
  diffScopeBySession: {},
  selectedDiffMessageBySession: {},
  isRefreshingMessages: false,
  isRefreshingDiffs: false,
};

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
  }));
}
