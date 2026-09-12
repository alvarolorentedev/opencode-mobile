import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  CHAT_PREFERENCES_STORAGE_KEY,
  LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-provider-utils';
import { loadPersistedValue } from '@/providers/persistence-hydration';

function parseJsonObject<T>(raw: string) {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as T;
}

function parseLastSessionByProject(raw: string) {
  const value = parseJsonObject<Record<string, unknown>>(raw);
  if (Object.values(value).some((sessionId) => typeof sessionId !== 'string')) {
    throw new Error('Expected session IDs to be strings.');
  }
  return value as Record<string, string>;
}

export function useOpencodePersistence({
  defaultChatPreferences,
  defaultSettings,
  activeProjectPath,
  chatPreferences,
  lastSessionByProject,
  setActiveProjectPath,
  setChatPreferences,
  setLastSessionByProject,
  setSettings,
  settings,
}: {
  defaultChatPreferences: ChatPreferences;
  defaultSettings: OpencodeConnectionSettings;
  activeProjectPath?: string;
  chatPreferences: ChatPreferences;
  lastSessionByProject: Record<string, string>;
  setActiveProjectPath: (value?: string) => void;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setLastSessionByProject: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  settings: OpencodeConnectionSettings;
}) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function hydrateState() {
      try {
        await loadPersistedValue(AsyncStorage, SETTINGS_STORAGE_KEY, parseJsonObject<Partial<OpencodeConnectionSettings>>, (parsed) => {
          setSettings({
            ...defaultSettings,
            ...parsed,
          });
        });

        await loadPersistedValue(AsyncStorage, CHAT_PREFERENCES_STORAGE_KEY, parseJsonObject<Partial<ChatPreferences>>, (parsed) => {
          setChatPreferences((current) => ({
            ...defaultChatPreferences,
            ...current,
            ...parsed,
          }));
        });

        await loadPersistedValue(AsyncStorage, ACTIVE_PROJECT_STORAGE_KEY, (raw) => raw, (path) => {
          if (path) {
            setActiveProjectPath(path);
          }
        });

        await loadPersistedValue(AsyncStorage, LAST_SESSION_BY_PROJECT_STORAGE_KEY, parseLastSessionByProject, setLastSessionByProject);
      } finally {
        setIsHydrated(true);
      }
    }

    void hydrateState();
  }, [defaultChatPreferences, defaultSettings, setActiveProjectPath, setChatPreferences, setLastSessionByProject, setSettings]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [isHydrated, settings]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(chatPreferences));
  }, [chatPreferences, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (activeProjectPath) {
      void AsyncStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectPath);
      return;
    }

    void AsyncStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  }, [activeProjectPath, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(LAST_SESSION_BY_PROJECT_STORAGE_KEY, JSON.stringify(lastSessionByProject));
  }, [isHydrated, lastSessionByProject]);

  return { isHydrated };
}
