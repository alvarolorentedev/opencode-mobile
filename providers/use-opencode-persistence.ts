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
      // Each key is parsed independently. A single corrupt value (e.g.,
      // truncated JSON written by a crashed prior run) used to abort all
      // remaining hydration steps via the outer catch below, leaving the
      // user stuck with defaults even for the keys that were intact.
      async function loadKey<T>(key: string, parse: (raw: string) => T, apply: (parsed: T) => void) {
        try {
          const raw = await AsyncStorage.getItem(key);
          if (raw === null) {
            return;
          }
          apply(parse(raw));
        } catch {
          // Drop the corrupt value so subsequent writes replace it cleanly.
          void AsyncStorage.removeItem(key).catch(() => undefined);
        }
      }

      await Promise.all([
        loadKey(
          SETTINGS_STORAGE_KEY,
          (raw) => JSON.parse(raw) as Partial<OpencodeConnectionSettings>,
          (parsed) => setSettings({ ...defaultSettings, ...parsed }),
        ),
        loadKey(
          CHAT_PREFERENCES_STORAGE_KEY,
          (raw) => JSON.parse(raw) as Partial<ChatPreferences>,
          (parsed) => setChatPreferences((current) => ({ ...defaultChatPreferences, ...current, ...parsed })),
        ),
        loadKey(
          ACTIVE_PROJECT_STORAGE_KEY,
          (raw) => raw, // stored as a plain string, not JSON
          (parsed) => {
            if (parsed) {
              setActiveProjectPath(parsed);
            }
          },
        ),
        loadKey(
          LAST_SESSION_BY_PROJECT_STORAGE_KEY,
          (raw) => JSON.parse(raw) as Record<string, string>,
          (parsed) => setLastSessionByProject(parsed),
        ),
      ]);

      setIsHydrated(true);
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
