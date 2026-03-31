import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
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

let initialized = false;
let notificationHandlerRegistered = false;
let notificationsModulePromise: Promise<typeof import('expo-notifications') | null> | null = null;
let taskManagerModulePromise: Promise<typeof import('expo-task-manager') | null> | null = null;
let backgroundTaskModulePromise: Promise<typeof import('expo-background-task') | null> | null = null;
let backgroundTaskDefined = false;

function canUseNotifications() {
  return Platform.OS !== 'web' && Constants.appOwnership !== 'expo';
}

async function getNotificationsModule() {
  if (!canUseNotifications()) {
    return null;
  }

  if (!notificationsModulePromise) {
    notificationsModulePromise = import('expo-notifications');
  }

  return notificationsModulePromise;
}

function canUseBackgroundMonitoring() {
  return Platform.OS !== 'web' && Constants.appOwnership !== 'expo';
}

async function getTaskManagerModule() {
  if (!canUseBackgroundMonitoring()) {
    return null;
  }

  if (!taskManagerModulePromise) {
    taskManagerModulePromise = import('expo-task-manager');
  }

  return taskManagerModulePromise;
}

async function getBackgroundTaskModule() {
  if (!canUseBackgroundMonitoring()) {
    return null;
  }

  if (!backgroundTaskModulePromise) {
    backgroundTaskModulePromise = import('expo-background-task');
  }

  return backgroundTaskModulePromise;
}

function registerForegroundNotificationHandler() {
  if (notificationHandlerRegistered) {
    return;
  }

  notificationHandlerRegistered = true;
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

async function scheduleTaskFinishedNotification(sessionTitle?: string) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'OpenCode finished a task',
      body: sessionTitle?.trim() || 'Task complete',
      sound: true,
    },
    trigger: null,
  });
}

async function ensureBackgroundTaskDefined() {
  if (backgroundTaskDefined || !canUseBackgroundMonitoring()) {
    return;
  }

  const [TaskManager, BackgroundTask] = await Promise.all([getTaskManagerModule(), getBackgroundTaskModule()]);
  if (!TaskManager || !BackgroundTask) {
    return;
  }

  if (!TaskManager.isTaskDefined(CHAT_COMPLETION_TASK_NAME)) {
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

  backgroundTaskDefined = true;
}

async function registerBackgroundTaskAsync() {
  if (!canUseBackgroundMonitoring()) {
    return;
  }

  await ensureBackgroundTaskDefined();

  const [TaskManager, BackgroundTask] = await Promise.all([getTaskManagerModule(), getBackgroundTaskModule()]);
  if (!TaskManager || !BackgroundTask) {
    return;
  }

  const available = await TaskManager.isAvailableAsync();
  if (!available) {
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
  if (initialized) {
    return;
  }

  registerForegroundNotificationHandler();

  if (canUseNotifications()) {
    const Notifications = await getNotificationsModule();
    if (!Notifications) {
      initialized = true;
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

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(TASK_FINISHED_CHANNEL_ID, {
        name: 'Task finished',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 180, 120, 180],
      });
    }

    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted && permissions.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  }

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
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger: null,
  });
}
