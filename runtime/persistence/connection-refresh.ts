import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { parsePendingNotificationSessions, serializePendingNotificationSessions } from '@/features/notifications/runtime';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/shared/storage/keys';
import { migrateCapabilitiesSnapshots } from '@/features/ai/runtime';
import { migrateMissionStatsCaches } from '@/features/sessions/runtime';
import type { FavoriteSession } from '@/features/sessions/index';
import type { AppCore } from '@/runtime/core/create-app-core';
import { migrateTranscriptCaches } from '@/features/chat/runtime';

export async function migrateConnectConnectionScope(previous: ConnectionProfile, next: ConnectionProfile, {
  store, persistence: { flushPreferences },
}: Pick<AppCore, 'store' | 'persistence'>) {
  const oldScope = getConnectionScope(previous), newScope = getConnectionScope(next);
  if (oldScope === newScope) return;
  if (!previous.connect || previous.connect.machineId !== next.connect?.machineId || previous.connect.controlPlaneUrl !== next.connect.controlPlaneUrl) throw new Error('machine_identity_mismatch');
  // ponytail: retain old non-secret caches for safe interrupted retries;
  // add migration journaling and pruning if many renewals grow storage.
  const pendingRaw = await AsyncStorage.getItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
  const originals = new Map<FavoriteSession, FavoriteSession>();
  const { setShellValue } = store.getState();
  const rollback = async () => {
    if (originals.size) setShellValue('favoriteSessions', (items) => items.map((entry) => originals.get(entry) ?? entry));
    await Promise.all([
      flushPreferences(),
      pendingRaw === null ? AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY)
        : AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, pendingRaw),
    ]);
  };
  try {
    setShellValue('favoriteSessions', (items) => {
      const nextItems = items.map((entry) => {
        if (entry.connectionScope !== oldScope) return entry;
        const updated = { ...entry, connectionScope: newScope };
        originals.set(updated, entry);
        return updated;
      });
      return originals.size ? nextItems : items;
    });
    await flushPreferences();
    if (pendingRaw) {
      const pending = Object.fromEntries(Object.entries(parsePendingNotificationSessions(pendingRaw)).map(([key, entry]) => [key, entry.connectionScope === oldScope ? { ...entry, connectionScope: newScope, settings: { serverUrl: next.serverUrl, username: next.username } } : entry]));
      await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, serializePendingNotificationSessions(pending));
    }
    await migrateMissionStatsCaches(oldScope, newScope);
    await migrateTranscriptCaches(oldScope, newScope);
    await migrateCapabilitiesSnapshots(oldScope, newScope);
  } catch (reason) { await rollback(); throw reason; }
  return rollback;
}
