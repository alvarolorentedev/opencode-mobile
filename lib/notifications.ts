import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { buildClient, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/lib/storage-keys';

const TASK_FINISHED_CHANNEL_ID = 'task-finished';
const CHAT_COMPLETION_TASK_NAME = 'opencode-chat-completion-monitor';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;

type PendingNotificationSession = {
  sessionId: string;
  sessionTitle?: string;
  projectPath: string;
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password'>;
  requestedAt: number;
};

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

    return JSON.parse(raw) as Record<string, PendingNotificationSession>;
  } catch {
    return {} as Record<string, PendingNotificationSession>;
  }
}

async function writePendingNotificationSessions(value: Record<string, PendingNotificationSession>) {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    await AsyncStorage.removeItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
    return;
  }

  await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify(value));
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
      const pendingBySessionId = await readPendingNotificationSessions();
      const pendingSessions = Object.values(pendingBySessionId);

      if (pendingSessions.length === 0) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      for (const pending of pendingSessions) {
        if (!pending.projectPath) {
          delete pendingBySessionId[pending.sessionId];
          continue;
        }

        try {
          const client = buildClient({
            serverUrl: pending.settings.serverUrl,
            username: pending.settings.username,
            password: pending.settings.password,
            directory: pending.projectPath,
          });
          const [statusesResponse, sessionsResponse] = await Promise.all([
            client.session.status().catch(() => undefined),
            client.session.list().catch(() => undefined),
          ]);

          const status = statusesResponse?.data?.[pending.sessionId];
          if (status && status.type !== 'idle') {
            continue;
          }

          const session = sessionsResponse?.data?.find((item: { id: string; title?: string }) => item.id === pending.sessionId);
          await scheduleTaskFinishedNotification(session?.title || pending.sessionTitle);
          delete pendingBySessionId[pending.sessionId];
        } catch {
          continue;
        }
      }

      await writePendingNotificationSessions(pendingBySessionId);
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
  await ensureNotificationPermissionsAsync();
  await registerBackgroundTaskAsync();
  initialized = true;
}

export async function trackPendingTaskFinishedNotification(input: PendingNotificationSession) {
  const current = await readPendingNotificationSessions();
  current[input.sessionId] = input;
  await writePendingNotificationSessions(current);
}

export async function clearPendingTaskFinishedNotification(sessionId: string) {
  const current = await readPendingNotificationSessions();
  if (!current[sessionId]) {
    return;
  }

  delete current[sessionId];
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
