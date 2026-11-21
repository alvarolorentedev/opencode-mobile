import { createStore, type StoreApi } from 'zustand/vanilla';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { FavoriteSession, HiddenProjectsByConnection } from '@/shared/contracts/domain';

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

export type AppState = {
  shell: ShellState;
  setShellValue: <K extends keyof ShellState>(
    key: K,
    value: ShellState[K] | ((current: ShellState[K]) => ShellState[K]),
  ) => void;
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
    setShellValue: (key, value) => set((state) => ({
      shell: {
        ...state.shell,
        [key]: typeof value === 'function'
          ? (value as (current: ShellState[typeof key]) => ShellState[typeof key])(state.shell[key])
          : value,
      },
    })),
  }));
}
