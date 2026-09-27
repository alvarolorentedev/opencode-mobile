import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { resolveConnectionPassword } from '@/lib/connection-profiles';
import { buildClient, detectServerContract, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import {
  parsePendingNotificationSessions,
  pendingNotificationKey,
  serializePendingNotificationSessions,
  type PendingNotificationSession,
} from '@/lib/notification-pending';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/lib/storage-keys';

const TASK_FINISHED_CHANNEL_ID = 'task-finished';
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
  try {
    const raw = await AsyncStorage.getItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, PendingNotificationSession>;
    }

    const pending = parsePendingNotificationSessions(raw);
    const serialized = serializePendingNotificationSessions(pending);
    if (serialized !== raw) {
      void AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, serialized).catch(() => undefined);
    }
    return pending;
  } catch {
    // Malformed JSON cannot be attributed to any connection; drop it so a bad
    // value does not block later writes.
    await AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY).catch(() => undefined);
    return {} as Record<string, PendingNotificationSession>;
  }
}

async function writePendingNotificationSessions(value: Record<string, PendingNotificationSession>) {
  if (Object.keys(value).length === 0) {
    await AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
    return;
  }

  // The serializer only keeps the explicit non-secret DTO fields.
  await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, serializePendingNotificationSessions(value));
}

function buildTaskFinishedContent(title: string, body: string): Notifications.NotificationContentInput {
  return {
    title,
    body,
    sound: true,
    ...(Platform.OS === 'android' ? { channelId: TASK_FINISHED_CHANNEL_ID } : {}),
  };
}

async function scheduleLocalNotification(title: string, body: string) {
  if (!canUseNotifications()) {
    return null;
  }

  return Notifications.scheduleNotificationAsync({
    content: buildTaskFinishedContent(title, body),
    trigger: null,
  });
}

async function scheduleTaskFinishedNotification(sessionTitle?: string) {
  await scheduleLocalNotification('OpenCode finished a task', sessionTitle?.trim() || 'Task complete');
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(CHAT_COMPLETION_TASK_NAME)) {
  TaskManager.defineTask(CHAT_COMPLETION_TASK_NAME, async () => {
    try {
      const pendingByKey = await readPendingNotificationSessions();
      const pendingSessions = Object.entries(pendingByKey);

      if (pendingSessions.length === 0) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      for (const [key, pending] of pendingSessions) {
        if (!pending.projectPath) {
          delete pendingByKey[key];
          continue;
        }

        // Resolve the credentials of the connection that created the record.
        // The currently active connection is only used when this record
        // belongs to it; another server's task must never borrow its password.
        const password = await resolveConnectionPassword({
          serverUrl: pending.settings.serverUrl,
          username: pending.settings.username,
        }).catch(() => undefined);
        if (password === undefined) {
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
            password,
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
            delete pendingByKey[key];
            continue;
          }
          await scheduleTaskFinishedNotification(session?.title || pending.sessionTitle);
          delete pendingByKey[key];
        } catch {
          continue;
        }
      }

      await writePendingNotificationSessions(pendingByKey);
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
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
  });
}

export async function getNotificationPermissionsStatusAsync() {
  if (!canUseNotifications()) {
    return null;
  }

  return Notifications.getPermissionsAsync();
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
  const pendingSessionCount = Object.keys(await readPendingNotificationSessions()).length;

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
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await configureNotificationChannelAsync();
  await registerBackgroundTaskAsync();
  initialized = true;
}

export async function trackPendingTaskFinishedNotification(input: PendingNotificationSession) {
  const current = await readPendingNotificationSessions();
  current[pendingNotificationKey(input.connectionScope, input.sessionId)] = input;
  await writePendingNotificationSessions(current);
}

export async function clearPendingTaskFinishedNotification(connectionScope: string, sessionId: string) {
  const current = await readPendingNotificationSessions();
  const key = pendingNotificationKey(connectionScope, sessionId);
  if (!current[key]) {
    return;
  }

  delete current[key];
  await writePendingNotificationSessions(current);
}

export async function notifyTaskFinished(title: string, body: string) {
  await scheduleLocalNotification(title, body);
}

export async function sendTestNotificationAsync() {
  const permissions = await ensureNotificationPermissionsAsync();
  if (!permissions?.granted) {
    return false;
  }

  await scheduleLocalNotification('OpenCode notifications are on', 'This is a test notification from your device.');
  return true;
}
