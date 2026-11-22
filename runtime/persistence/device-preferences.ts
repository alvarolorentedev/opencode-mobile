import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistOptions } from 'zustand/middleware';

import { loadOnboardingStatus, serializeOnboardingVersion } from '@/features/onboarding/runtime';
import { parseHiddenProjects, serializeHiddenProjects } from '@/features/projects/runtime';
import { parseFavoriteSessions, serializeFavoriteSessions } from '@/features/sessions/runtime';
import type { AppState, ShellState } from '@/runtime/core/store';
import { normalizeTrustedControlPlaneUrl } from '@/shared/contracts/cloud-link';
import {
  CHAT_PREFERENCES_STORAGE_KEY, CONNECT_CONTROL_PLANE_STORAGE_KEY, DEVICE_PREFERENCES_VERSION_KEY,
  FAVORITE_SESSIONS_STORAGE_KEY, HIDDEN_PROJECTS_STORAGE_KEY, LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  ONBOARDING_VERSION_STORAGE_KEY, PROJECTS_STORAGE_KEY,
} from '@/shared/storage/keys';
import { createPersistenceWriter, loadPersistedValue } from '@/shared/storage/persistence-hydration';
import { parseChatPreferences } from '@/shared/storage/persisted-preferences';

type PersistedPreferences = {
  chatPreferences?: Partial<ShellState['chatPreferences']>;
} & Partial<Pick<ShellState, 'favoriteSessions' | 'hiddenProjects' | 'controlPlaneUrl' | 'onboardingVersion'>>;
type DeviceStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;
const VERSION = 1;

export function createDevicePreferences(storage: DeviceStorage = AsyncStorage) {
  const write = createPersistenceWriter();
  let selected: PersistedPreferences | undefined;
  let written: PersistedPreferences | undefined;
  let pending = Promise.resolve();
  let writable = false;

  function partialize({ shell: { chatPreferences, controlPlaneUrl, favoriteSessions, hiddenProjects, onboardingVersion } }: AppState) {
    if (selected?.chatPreferences === chatPreferences && selected.controlPlaneUrl === controlPlaneUrl
      && selected.favoriteSessions === favoriteSessions && selected.hiddenProjects === hiddenProjects
      && selected.onboardingVersion === onboardingVersion) return selected;
    return selected = { chatPreferences, controlPlaneUrl, favoriteSessions, hiddenProjects, onboardingVersion };
  }

  const options: PersistOptions<AppState, PersistedPreferences> = {
    name: DEVICE_PREFERENCES_VERSION_KEY,
    version: VERSION,
    skipHydration: true,
    partialize,
    // Keep the existing per-field records so app upgrades, downloaded
    // development builds and headless widget/diagnostics readers share a format.
    storage: {
      async getItem(name) {
        const state: PersistedPreferences = {};
        let version: number | undefined;
        try {
          const stored = await storage.getItem(name);
          version = stored === null ? 0 : Number(stored);
          if (!Number.isSafeInteger(version) || version < 0 || version > VERSION) version = undefined;
        } catch (error) {
          console.warn('Could not read the device preferences version.', error);
        }
        const source = version === undefined ? {
          getItem: (key: string) => storage.getItem(key),
          removeItem: async () => {},
        } : storage;
        async function load<T>(key: string, parse: (raw: string) => T, apply: (value: T) => void) {
          if (!await loadPersistedValue(source, key, parse, apply)) write.preserveUnread(key);
        }
        await Promise.all([
          load(CHAT_PREFERENCES_STORAGE_KEY, parseChatPreferences, (value) => { state.chatPreferences = value; }),
          load(CONNECT_CONTROL_PLANE_STORAGE_KEY, normalizeTrustedControlPlaneUrl, (value) => { state.controlPlaneUrl = value; }),
          load(FAVORITE_SESSIONS_STORAGE_KEY, parseFavoriteSessions, (value) => { state.favoriteSessions = value; }),
          load(HIDDEN_PROJECTS_STORAGE_KEY, parseHiddenProjects, (value) => { state.hiddenProjects = value; }),
          loadOnboardingStatus(source).then(({ version }) => { state.onboardingVersion = version; }),
          ...[PROJECTS_STORAGE_KEY, LAST_SESSION_BY_PROJECT_STORAGE_KEY].map((key) => source.removeItem(key)
            .catch((error) => console.warn(`Could not clear ${key}.`, error))),
        ]);
        writable = version !== undefined;
        return { version, state };
      },
      setItem(name, { state, version }) {
        if (!writable || state === written) return;
        written = state;
        const values = [
          [CHAT_PREFERENCES_STORAGE_KEY, state.chatPreferences && JSON.stringify(parseChatPreferences(JSON.stringify(state.chatPreferences)))],
          [CONNECT_CONTROL_PLANE_STORAGE_KEY, state.controlPlaneUrl || undefined],
          [FAVORITE_SESSIONS_STORAGE_KEY, state.favoriteSessions && serializeFavoriteSessions(state.favoriteSessions)],
          [HIDDEN_PROJECTS_STORAGE_KEY, state.hiddenProjects && serializeHiddenProjects(state.hiddenProjects)],
          [ONBOARDING_VERSION_STORAGE_KEY, state.onboardingVersion !== undefined ? serializeOnboardingVersion(state.onboardingVersion) : undefined],
        ] as const;
        pending = Promise.all(values.map(([key, value]) => value === undefined ? undefined
          : write(key, value, () => storage.setItem(key, value)))).then(async () => {
          if (version !== undefined) await write(name, String(version), () => storage.setItem(name, String(version)));
        });
        return pending.catch((error) => {
          if (written === state) written = undefined;
          console.warn('Could not save device preferences.', error);
        });
      },
      async removeItem(name) {
        await Promise.all([name, CHAT_PREFERENCES_STORAGE_KEY, CONNECT_CONTROL_PLANE_STORAGE_KEY, FAVORITE_SESSIONS_STORAGE_KEY,
          HIDDEN_PROJECTS_STORAGE_KEY, ONBOARDING_VERSION_STORAGE_KEY].map((key) => write(key, null, () => storage.removeItem(key))));
        written = undefined;
      },
    },
    // Version 0 is the existing unversioned collection. The owning parsers
    // normalize each field on read, and persist writes the schema marker once.
    migrate: (value) => value as PersistedPreferences,
    merge(persisted, current) {
      const { chatPreferences, ...fields } = (persisted ?? {}) as PersistedPreferences;
      return { ...current, shell: { ...current.shell, ...fields,
        chatPreferences: { ...current.shell.chatPreferences, ...chatPreferences } } };
    },
  };

  return { options, flush: () => pending };
}
