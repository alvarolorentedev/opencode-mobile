import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import { normalizeTrustedControlPlaneUrl } from '@/lib/connect';
import { getConnectionPassword, saveConnectionPassword, withoutConnectionSecrets } from '@/lib/connection-password';
import { getConnectionHeaders, saveConnectionHeaders, type ConnectionHeaders } from '@/lib/connection-headers';
import { isValidServerUrl } from '@/lib/opencode/client/url';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  CHAT_PREFERENCES_STORAGE_KEY,
  CONNECT_CONTROL_PLANE_STORAGE_KEY,
  FAVORITE_SESSIONS_STORAGE_KEY,
  LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  ONBOARDING_VERSION_STORAGE_KEY,
  PROJECTS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { FavoriteSession, ProjectPathsByConnection } from '@/providers/opencode-provider-types';
import { parseFavoriteSessions, serializeFavoriteSessions } from '@/providers/favorites-storage';
import { parseProjectPathsByConnection, serializeProjectPathsByConnection } from '@/providers/projects-storage';
import {
  loadOnboardingStatus,
  serializeOnboardingVersion,
} from '@/providers/onboarding-state';
import {
  parseLastSessionByConnection,
  serializeLastSessionByConnection,
  type LastSessionByConnection,
} from '@/providers/last-session-storage';
import { parseChatPreferences, parseConnectionSettings } from '@/providers/persisted-preferences';
import { createPersistenceWriter, loadPersistedValue } from '@/providers/persistence-hydration';


export function useOpencodePersistence({
  defaultChatPreferences,
  defaultSettings,
  activeProjectPath,
  chatPreferences,
  controlPlaneUrl,
  favoriteSessions,
  lastSessionByConnection,
  onboardingVersion,
  projectPathsByConnection,
  setActiveProjectPath,
  setChatPreferences,
  setControlPlaneUrl,
  setFavoriteSessions,
  setLastSessionByConnection,
  setOnboardingVersion,
  setProjectPathsByConnection,
  setSettings,
  settings,
}: {
  defaultChatPreferences: ChatPreferences;
  defaultSettings: OpencodeConnectionSettings;
  activeProjectPath?: string;
  chatPreferences: ChatPreferences;
  controlPlaneUrl: string;
  favoriteSessions: FavoriteSession[];
  lastSessionByConnection: LastSessionByConnection;
  onboardingVersion: number;
  projectPathsByConnection: ProjectPathsByConnection;
  setActiveProjectPath: (value?: string) => void;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setControlPlaneUrl: Dispatch<SetStateAction<string>>;
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
  setLastSessionByConnection: Dispatch<SetStateAction<LastSessionByConnection>>;
  setOnboardingVersion: Dispatch<SetStateAction<number>>;
  setProjectPathsByConnection: Dispatch<SetStateAction<ProjectPathsByConnection>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  settings: OpencodeConnectionSettings;
}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [writeChanged] = useState(createPersistenceWriter);
  const persist = useCallback((key: string, value: string | null) => writeChanged(key, value, () => value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)), [writeChanged]);

  useEffect(() => {
    async function hydrateState() {
      const load = async <T,>(key: string, parse: (raw: string) => T, apply: (value: T) => void) => {
        if (!await loadPersistedValue(AsyncStorage, key, parse, apply)) writeChanged.preserveUnread(key);
      };
      try {
        let persistedSettings: Partial<OpencodeConnectionSettings> | undefined;
        await load(SETTINGS_STORAGE_KEY, parseConnectionSettings, (parsed) => {
          persistedSettings = parsed;
        });
        const hasConnectionIdentity = Boolean(persistedSettings?.serverUrl?.trim() && isValidServerUrl(persistedSettings.serverUrl));
        const hasLegacyPassword = Boolean(hasConnectionIdentity && persistedSettings && 'password' in persistedSettings);
        const legacyPassword = hasConnectionIdentity ? persistedSettings?.password || '' : '';
        let password = legacyPassword;
        try {
          if (hasLegacyPassword) {
            await saveConnectionPassword(legacyPassword);
            await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(withoutConnectionSecrets({ ...defaultSettings, ...persistedSettings })));
          }
          password = hasConnectionIdentity ? (await getConnectionPassword()) || legacyPassword : '';
        } catch (reason) {
          writeChanged.preserveUnread(SETTINGS_STORAGE_KEY);
          console.warn('Could not hydrate connection credentials.', reason);
        }
        let headers: ConnectionHeaders = {};
        try {
          // Like the password, unread server metadata must not lend stored
          // gateway headers to the default server.
          if (hasConnectionIdentity) headers = await getConnectionHeaders();
        } catch (reason) {
          console.warn('Could not hydrate connection headers.', reason);
        }
        setSettings({ ...defaultSettings, ...persistedSettings, password, headers });

        await load(CHAT_PREFERENCES_STORAGE_KEY, parseChatPreferences, (parsed) => {
          setChatPreferences((current) => ({
            ...defaultChatPreferences,
            ...current,
            ...parsed,
          }));
        });

        await load(ACTIVE_PROJECT_STORAGE_KEY, (raw) => raw, (path) => {
          if (path) {
            setActiveProjectPath(path);
          }
        });

        await load(LAST_SESSION_BY_PROJECT_STORAGE_KEY, parseLastSessionByConnection, setLastSessionByConnection);

        await load(FAVORITE_SESSIONS_STORAGE_KEY, parseFavoriteSessions, setFavoriteSessions);

        await load(PROJECTS_STORAGE_KEY, parseProjectPathsByConnection, setProjectPathsByConnection);

        await load(CONNECT_CONTROL_PLANE_STORAGE_KEY, normalizeTrustedControlPlaneUrl, setControlPlaneUrl);

        // Resolve first-run completion last so `isHydrated` already implies the
        // onboarding decision is known. The marker, including the migration
        // decision, is persisted by the write-back effect below.
        const onboardingStatus = await loadOnboardingStatus(AsyncStorage);
        setOnboardingVersion(onboardingStatus.version);
      } finally {
        setIsHydrated(true);
      }
    }

    void hydrateState().catch((reason) => console.warn('Could not hydrate app settings.', reason));
  }, [defaultChatPreferences, defaultSettings, setActiveProjectPath, setChatPreferences, setControlPlaneUrl, setFavoriteSessions, setLastSessionByConnection, setOnboardingVersion, setProjectPathsByConnection, setSettings, writeChanged]);

  useEffect(() => {
    if (isHydrated && controlPlaneUrl) void persist(CONNECT_CONTROL_PLANE_STORAGE_KEY, controlPlaneUrl).catch((reason) => console.warn('Could not save Connect settings.', reason));
  }, [controlPlaneUrl, isHydrated, persist]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const metadata = JSON.stringify(withoutConnectionSecrets(settings));
    const credential = JSON.stringify([settings.password, Boolean(settings.connect)]);
    const headerValue = JSON.stringify(settings.headers ?? {});
    void writeChanged(SETTINGS_STORAGE_KEY, JSON.stringify([metadata, credential, headerValue]), async () => {
      await writeChanged('connection-password', credential, () => saveConnectionPassword(settings.password, Boolean(settings.connect)));
      await writeChanged('connection-headers', headerValue, () => saveConnectionHeaders(settings.headers));
      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, metadata);
    }).catch((reason) => console.warn('Could not save connection settings.', reason));
  }, [isHydrated, settings, writeChanged]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void persist(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(chatPreferences)).catch((reason) => console.warn('Could not save chat preferences.', reason));
  }, [chatPreferences, isHydrated, persist]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (activeProjectPath) {
      void persist(ACTIVE_PROJECT_STORAGE_KEY, activeProjectPath).catch((reason) => console.warn('Could not save project.', reason));
      return;
    }

    void persist(ACTIVE_PROJECT_STORAGE_KEY, null).catch((reason) => console.warn('Could not clear project.', reason));
  }, [activeProjectPath, isHydrated, persist]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void persist(LAST_SESSION_BY_PROJECT_STORAGE_KEY, serializeLastSessionByConnection(lastSessionByConnection)).catch((reason) => console.warn('Could not save lastSessionByConnection.', reason));
  }, [isHydrated, lastSessionByConnection, persist]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void persist(FAVORITE_SESSIONS_STORAGE_KEY, serializeFavoriteSessions(favoriteSessions)).catch((reason) => console.warn('Could not save favoriteSessions.', reason));
  }, [favoriteSessions, isHydrated, persist]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void persist(PROJECTS_STORAGE_KEY, serializeProjectPathsByConnection(projectPathsByConnection)).catch((reason) => console.warn('Could not save opened projects.', reason));
  }, [isHydrated, persist, projectPathsByConnection]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void persist(ONBOARDING_VERSION_STORAGE_KEY, serializeOnboardingVersion(onboardingVersion)).catch((reason) => console.warn('Could not save onboardingVersion.', reason));
  }, [isHydrated, onboardingVersion, persist]);

  return { isHydrated };
}
