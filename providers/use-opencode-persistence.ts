import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  CHAT_PREFERENCES_STORAGE_KEY,
  LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  sessionStatusesCacheKey,
  sessionsCacheKey,
} from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-provider-utils';

export function useOpencodePersistence({
  defaultChatPreferences,
  defaultSettings,
  activeProjectPath,
  chatPreferences,
  lastSessionByProject,
  sessions,
  sessionStatuses,
  setActiveProjectPath,
  setChatPreferences,
  setLastSessionByProject,
  setSessions,
  setSessionStatuses,
  setSettings,
  settings,
}: {
  defaultChatPreferences: ChatPreferences;
  defaultSettings: OpencodeConnectionSettings;
  activeProjectPath?: string;
  chatPreferences: ChatPreferences;
  lastSessionByProject: Record<string, string>;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  setActiveProjectPath: (value?: string) => void;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setLastSessionByProject: Dispatch<SetStateAction<Record<string, string>>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  settings: OpencodeConnectionSettings;
}) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function hydrateState() {
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

      // Hydrate per-project session cache AFTER activeProjectPath is applied.
      // Lets the Workspace tab paint last-known sessions instantly instead of
      // waiting for fetchSessions() to round-trip on connect.
      try {
        const storedActiveProject = await AsyncStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        if (storedActiveProject) {
          await Promise.all([
            loadKey(
              sessionsCacheKey(storedActiveProject),
              (raw) => JSON.parse(raw) as Session[],
              (parsed) => {
                if (Array.isArray(parsed) && parsed.length > 0) {
                  setSessions(parsed);
                }
              },
            ),
            loadKey(
              sessionStatusesCacheKey(storedActiveProject),
              (raw) => JSON.parse(raw) as Record<string, SessionStatus>,
              (parsed) => {
                if (parsed && typeof parsed === 'object') {
                  setSessionStatuses(parsed);
                }
              },
            ),
          ]);
        }
      } catch {
        // Non-fatal — server fetch will repopulate.
      }

      setIsHydrated(true);
    }

    void hydrateState();
  }, [defaultChatPreferences, defaultSettings, setActiveProjectPath, setChatPreferences, setLastSessionByProject, setSessions, setSessionStatuses, setSettings]);

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

  // Persist session list + statuses per-project so reopening the app or
  // switching back to a known project paints instantly. Skips writes when
  // the array is empty (initial state or after a project switch clears it)
  // to avoid wiping a valid cache during transient clears.
  useEffect(() => {
    if (!isHydrated || !activeProjectPath || sessions.length === 0) {
      return;
    }
    void AsyncStorage.setItem(sessionsCacheKey(activeProjectPath), JSON.stringify(sessions));
  }, [activeProjectPath, isHydrated, sessions]);

  useEffect(() => {
    if (!isHydrated || !activeProjectPath || Object.keys(sessionStatuses).length === 0) {
      return;
    }
    void AsyncStorage.setItem(sessionStatusesCacheKey(activeProjectPath), JSON.stringify(sessionStatuses));
  }, [activeProjectPath, isHydrated, sessionStatuses]);

  return { isHydrated };
}
