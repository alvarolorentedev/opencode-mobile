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
        const storedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);

        if (storedSettings) {
          const parsed = JSON.parse(storedSettings) as Partial<OpencodeConnectionSettings>;
          setSettings({
            ...defaultSettings,
            ...parsed,
          });
        }

        const storedChatPreferences = await AsyncStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
        if (storedChatPreferences) {
          const parsed = JSON.parse(storedChatPreferences) as Partial<ChatPreferences>;
          setChatPreferences((current) => ({
            ...defaultChatPreferences,
            ...current,
            ...parsed,
          }));
        }

        const storedActiveProjectPath = await AsyncStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        if (storedActiveProjectPath) {
          setActiveProjectPath(storedActiveProjectPath);
        }

        const storedLastSessionByProject = await AsyncStorage.getItem(LAST_SESSION_BY_PROJECT_STORAGE_KEY);
        if (storedLastSessionByProject) {
          setLastSessionByProject(JSON.parse(storedLastSessionByProject) as Record<string, string>);
        }
      } catch {
        // Ignore hydration issues and keep defaults.
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
