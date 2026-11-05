import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { parsePendingNotificationSessions, serializePendingNotificationSessions } from '@/features/notifications/runtime';
import { FAVORITE_SESSIONS_STORAGE_KEY, PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/shared/storage/keys';
import { migrateCapabilitiesSnapshots } from '@/features/ai/runtime';
import { parseFavoriteSessions, serializeFavoriteSessions , migrateConnectionSessionCaches } from '@/features/sessions/runtime';
import { migrateTranscriptCaches } from '@/features/chat/runtime';

export async function migrateConnectConnectionScope(previous: ConnectionProfile, next: ConnectionProfile) {
  const oldScope = getConnectionScope(previous), newScope = getConnectionScope(next);
  if (oldScope === newScope) return;
  if (!previous.connect || previous.connect.machineId !== next.connect?.machineId || previous.connect.controlPlaneUrl !== next.connect.controlPlaneUrl) throw new Error('machine_identity_mismatch');
  // ponytail: retain old non-secret caches for safe interrupted retries;
  // add migration journaling and pruning if many renewals grow storage.
  const [favoritesRaw, pendingRaw] = await Promise.all([
    AsyncStorage.getItem(FAVORITE_SESSIONS_STORAGE_KEY), AsyncStorage.getItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY),
  ]);
  const originals = [[FAVORITE_SESSIONS_STORAGE_KEY, favoritesRaw], [PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, pendingRaw]] as const;
  const rollback = async () => {
    await Promise.all(originals.map(([key, raw]) => raw === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, raw)));
  };
  try {
    if (favoritesRaw) {
      const favorites = parseFavoriteSessions(favoritesRaw).map((entry) => entry.connectionScope === oldScope ? { ...entry, connectionScope: newScope } : entry);
      await AsyncStorage.setItem(FAVORITE_SESSIONS_STORAGE_KEY, serializeFavoriteSessions(favorites));
    }
    if (pendingRaw) {
      const pending = Object.fromEntries(Object.entries(parsePendingNotificationSessions(pendingRaw)).map(([key, entry]) => [key, entry.connectionScope === oldScope ? { ...entry, connectionScope: newScope, settings: { serverUrl: next.serverUrl, username: next.username } } : entry]));
      await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, serializePendingNotificationSessions(pending));
    }
    await migrateConnectionSessionCaches(oldScope, newScope);
    await migrateTranscriptCaches(oldScope, newScope);
    await migrateCapabilitiesSnapshots(oldScope, newScope);
  } catch (reason) { await rollback(); throw reason; }
  return rollback;
}
