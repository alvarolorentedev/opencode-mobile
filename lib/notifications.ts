import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { resolveConnectionCredentials } from '@/lib/connection-profiles';
import { isActivityCompletionManaged } from '@/lib/activity-notifications';
import { i18n } from '@/lib/i18n';
import { buildClient, detectServerContract, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import {
  parsePendingNotificationSessions,
  pendingNotificationKey,
  serializePendingNotificationSessions,
  type PendingNotificationSession,
} from '@/lib/notification-pending';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/lib/storage-keys';

const TASK_FINISHED_CHANNEL_ID = 'task-finished-silent';
const CHAT_COMPLETION_TASK_NAME = 'opencode-chat-completion-monitor';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;

export type NotificationDebugStatus = {
  platform: string;
  appOwnership?: string;
  notificationsSupported: boolean;
  backgroundMonitoringSupported: boolean;
  initialized: boolean;
  permissionGranted: boolean;
  permissionStatus: string;
  canAskAgain: boolean;
  backgroundTaskRegistered: boolean;
  backgroundTaskStatus: string;
  pendingSessionCount: number;
};

let initialized = false;
let pendingWrites: Promise<unknown> = Promise.resolve();

function withPendingSessions<T>(operation: () => Promise<T>): Promise<T> {
  // ponytail: one queue per JS runtime; use a transactional store if multiple
  // processes ever need to mutate this record concurrently.
  const result = pendingWrites.then(operation);
  pendingWrites = result.catch(() => undefined);
  return result;
}

function canUseNotifications() {
  return Platform.OS !== 'web';
}

function canUseBackgroundMonitoring() {
  return Platform.OS !== 'web' && Constants.appOwnership !== 'expo';
}

function getBackgroundTaskStatusLabel(value: BackgroundTask.BackgroundTaskStatus | null) {
  if (value == null) {
    return 'unknown';
  }

  const match = Object.entries(BackgroundTask.BackgroundTaskStatus).find(([, statusValue]) => statusValue === value);
  return match?.[0] || String(value);
}

async function readPendingNotificationSessions() {
  // A failed read must abort mutations, never masquerade as an empty store.
  const raw = await AsyncStorage.getItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
  if (!raw) return {} as Record<string, PendingNotificationSession>;
  let pending: Record<string, PendingNotificationSession>;
  try {
    pending = parsePendingNotificationSessions(raw);
  } catch {
    // Malformed JSON cannot be attributed to any connection; drop it so a bad
    // value does not block later writes.
    await AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY).catch(() => undefined);
    return {} as Record<string, PendingNotificationSession>;
  }
  // Remove legacy secret/unknown fields only after a successful read/parse.
  // Write errors propagate without being confused with malformed JSON.
  if (serializePendingNotificationSessions(pending) !== raw) await writePendingNotificationSessions(pending);
  return pending;
}

async function writePendingNotificationSessions(value: Record<string, PendingNotificationSession>) {
  if (Object.keys(value).length === 0) {
    await AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
    return;
  }

  // The serializer only keeps the explicit non-secret DTO fields.
  await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, serializePendingNotificationSessions(value));
}

function completePendingNotification(key: string, pending: PendingNotificationSession, notify?: () => Promise<void>) {
  return withPendingSessions(async () => {
    const current = await readPendingNotificationSessions();
    if (current[key]?.requestedAt !== pending.requestedAt) return;
    await notify?.();
    delete current[key];
    await writePendingNotificationSessions(current);
  });
}

function buildTaskFinishedContent(title: string, body: string): Notifications.NotificationContentInput {
  return {
    title,
    body,
    sound: Platform.OS !== 'android',
  };
}

async function scheduleLocalNotification(title: string, body: string) {
  if (!canUseNotifications()) {
    return null;
  }

  await configureNotificationChannelAsync();

  return Notifications.scheduleNotificationAsync({
    content: buildTaskFinishedContent(title, body),
    trigger: Platform.OS === 'android' ? { channelId: TASK_FINISHED_CHANNEL_ID } : null,
  });
}

async function scheduleTaskFinishedNotification(sessionTitle?: string) {
  await scheduleLocalNotification(
    i18n.t('notifications:taskFinished.title'),
    sessionTitle?.trim() || i18n.t('notifications:taskFinished.bodyFallback'),
  );
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(CHAT_COMPLETION_TASK_NAME)) {
  TaskManager.defineTask(CHAT_COMPLETION_TASK_NAME, async () => {
    try {
      const pendingByKey = await withPendingSessions(readPendingNotificationSessions);
      const pendingSessions = Object.entries(pendingByKey);

      if (pendingSessions.length === 0) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      for (const [key, pending] of pendingSessions) {
        if (!pending.projectPath) {
          await completePendingNotification(key, pending);
          continue;
        }

        // Resolve the credentials of the connection that created the record.
        // The currently active connection is only used when this record
        // belongs to it; another server's task must never borrow its password.
        const credentials = await resolveConnectionCredentials({
          serverUrl: pending.settings.serverUrl,
          username: pending.settings.username,
        }).catch(() => undefined);
        if (credentials === undefined) {
          // The profile or active connection that owns this task is not
          // resolvable right now (for example the user switched away from an
          // unsaved connection). Keep the record and retry on a later run
          // instead of discarding another server's task.
          continue;
        }

        try {
          const settings: OpencodeConnectionSettings = {
            serverUrl: pending.settings.serverUrl,
            username: pending.settings.username,
            ...credentials,
            directory: pending.projectPath,
          };
          const contract = (await detectServerContract(settings).catch(() => ({ contract: 'v1' as const }))).contract;
          const client = buildClient(settings, contract);
          const [statusesResponse, sessionsResponse] = await Promise.all([
            client.session.status(),
            client.session.list(),
          ]);

          const status = statusesResponse?.data?.[pending.sessionId];
          if (status && status.type !== 'idle') {
            continue;
          }

          const session = sessionsResponse?.data?.find((item: { id: string; title?: string }) => item.id === pending.sessionId);
          if (!session) {
            await completePendingNotification(key, pending);
            continue;
          }
          // Re-check ownership after the network read: a new prompt for this
          // session must not be notified or removed by the older monitor pass.
          await completePendingNotification(key, pending, () => notifyTaskFinished(session?.title || pending.sessionTitle, pending.connectionScope));
        } catch {
          continue;
        }
      }

      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

async function configureNotificationChannelAsync() {
  if (Platform.OS !== 'android' || !canUseNotifications()) {
    return;
  }

  await Notifications.setNotificationChannelAsync(TASK_FINISHED_CHANNEL_ID, {
    name: 'Task finished',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
  });
}

export async function ensureNotificationPermissionsAsync() {
  if (!canUseNotifications()) {
    return null;
  }

  await configureNotificationChannelAsync();

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted || !permissions.canAskAgain) {
    return permissions;
  }

  return Notifications.requestPermissionsAsync();
}

export async function getNotificationDebugStatusAsync(): Promise<NotificationDebugStatus> {
  const permissions = canUseNotifications() ? await Notifications.getPermissionsAsync() : null;
  const backgroundTaskRegistered = canUseBackgroundMonitoring()
    ? await TaskManager.isTaskRegisteredAsync(CHAT_COMPLETION_TASK_NAME)
    : false;
  const backgroundTaskStatus = canUseBackgroundMonitoring()
    ? getBackgroundTaskStatusLabel(await BackgroundTask.getStatusAsync())
    : 'unsupported';
  const pendingSessionCount = Object.keys(await withPendingSessions(readPendingNotificationSessions)).length;

  return {
    platform: Platform.OS,
    appOwnership: Constants.appOwnership || undefined,
    notificationsSupported: canUseNotifications(),
    backgroundMonitoringSupported: canUseBackgroundMonitoring(),
    initialized,
    permissionGranted: permissions?.granted ?? false,
    permissionStatus: permissions?.status ?? 'unavailable',
    canAskAgain: permissions?.canAskAgain ?? false,
    backgroundTaskRegistered,
    backgroundTaskStatus,
    pendingSessionCount,
  };
}

async function registerBackgroundTaskAsync() {
  if (!canUseBackgroundMonitoring()) {
    return;
  }

  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
    return;
  }

  const registered = await TaskManager.isTaskRegisteredAsync(CHAT_COMPLETION_TASK_NAME);
  if (registered) {
    return;
  }

  await BackgroundTask.registerTaskAsync(CHAT_COMPLETION_TASK_NAME, {
    minimumInterval: BACKGROUND_MINIMUM_INTERVAL_MINUTES,
  });
}

export async function initializeNotifications() {
  if (initialized || !canUseNotifications()) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: Platform.OS !== 'android',
      shouldSetBadge: false,
    }),
  });

  await configureNotificationChannelAsync();
  await registerBackgroundTaskAsync();
  initialized = true;
}

export async function trackPendingTaskFinishedNotification(input: PendingNotificationSession, onlyIfAbsent = false) {
  return withPendingSessions(async () => {
    const current = await readPendingNotificationSessions();
    const key = pendingNotificationKey(input.connectionScope, input.sessionId);
    if (onlyIfAbsent && current[key]) return current[key];
    current[key] = input;
    await writePendingNotificationSessions(current);
    return input;
  });
}

// The persisted store is the single source of truth for in-flight completion
// tracking. Callers read it scoped to their connection instead of mirroring the
// records locally.
export async function listPendingTaskFinishedNotifications(connectionScope?: string) {
  return withPendingSessions(async () => {
    const all = await readPendingNotificationSessions();
    return connectionScope
      ? Object.values(all).filter((pending) => pending.connectionScope === connectionScope)
      : Object.values(all);
  });
}

export async function clearPendingTaskFinishedNotification(connectionScope: string, sessionId: string, requestedAt?: number) {
  return withPendingSessions(async () => {
    const current = await readPendingNotificationSessions();
    const key = pendingNotificationKey(connectionScope, sessionId);
    if (!current[key]) return false;
    if (requestedAt !== undefined && current[key].requestedAt !== requestedAt) return false;
    delete current[key];
    await writePendingNotificationSessions(current);
    return true;
  });
}

// Notification copy is translated here, at the lib boundary, so callers pass
// only the session title and never render notification strings themselves.
export async function notifyTaskFinished(sessionTitle?: string, connectionScope?: string) {
  if (isActivityCompletionManaged(connectionScope)) return;
  await scheduleTaskFinishedNotification(sessionTitle);
}
