import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
  buildClient,
  detectServerContract,
  listPendingInteractions,
  replyToPendingPermission,
  type OpencodeConnectionSettings,
  type PendingPermissionRequest,
} from '@/lib/opencode/client';
import { getConnectionPassword } from '@/lib/connection-password';
import {
  PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY,
  PENDING_PERMISSION_NOTIFIED_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '@/lib/storage-keys';

const TASK_FINISHED_CHANNEL_ID = 'task-finished';
const CHAT_COMPLETION_TASK_NAME = 'opencode-chat-completion-monitor';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;
const PERMISSION_PENDING_CATEGORY_ID = 'permission-pending';
const PERMISSION_ACTION_APPROVE = 'approve';
const PERMISSION_ACTION_REJECT = 'reject';

type PendingNotificationSession = {
  sessionId: string;
  sessionTitle?: string;
  projectPath: string;
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username'>;
  requestedAt: number;
};

function withoutPendingPassword(value: Record<string, PendingNotificationSession>) {
  return Object.fromEntries(Object.entries(value).map(([sessionId, pending]) => [sessionId, {
    ...pending,
    settings: {
      serverUrl: pending.settings.serverUrl,
      username: pending.settings.username,
    },
  }])) as Record<string, PendingNotificationSession>;
}

// Dedupe ledger for lock-screen "pending permission" alerts. A record is stored
// per session/request so the 15-minute background run does not spam the same
// request. Entries are cleared when the client replies (see the provider) or on
// the next run when the permission is no longer pending on the server.
type PendingPermissionNotificationRecord = {
  sessionId: string;
  requestID: string;
  permissionTitle?: string;
  patterns?: string[];
  projectPath: string;
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username'>;
  notifiedAt: number;
};

function pendingPermissionRecordKey(sessionId: string, requestID: string) {
  return `${sessionId}/${requestID}`;
}

async function readPendingPermissionNotified() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PERMISSION_NOTIFIED_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, PendingPermissionNotificationRecord>;
    }
    return JSON.parse(raw) as Record<string, PendingPermissionNotificationRecord>;
  } catch {
    return {} as Record<string, PendingPermissionNotificationRecord>;
  }
}

async function writePendingPermissionNotified(value: Record<string, PendingPermissionNotificationRecord>) {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    await AsyncStorage.removeItem(PENDING_PERMISSION_NOTIFIED_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_PERMISSION_NOTIFIED_STORAGE_KEY, JSON.stringify(value));
}

export async function clearPendingPermissionNotification(sessionId: string, requestID?: string) {
  const current = await readPendingPermissionNotified();
  if (requestID) {
    delete current[pendingPermissionRecordKey(sessionId, requestID)];
  } else {
    for (const key of Object.keys(current)) {
      if (current[key]?.sessionId === sessionId) {
        delete current[key];
      }
    }
  }
  await writePendingPermissionNotified(current);
}

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

    const pending = withoutPendingPassword(JSON.parse(raw) as Record<string, PendingNotificationSession>);
    if (JSON.stringify(pending) !== raw) {
      void AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify(pending));
    }
    return pending;
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

  await AsyncStorage.setItem(PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify(withoutPendingPassword(value)));
}

async function isCurrentPendingConnection(pending: PendingNotificationSession) {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const settings = JSON.parse(raw) as Partial<OpencodeConnectionSettings>;
    return settings.serverUrl === pending.settings.serverUrl && settings.username === pending.settings.username;
  } catch {
    return false;
  }
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

function buildPermissionPendingContent(record: PendingPermissionNotificationRecord): Notifications.NotificationContentInput {
  const permissionTitle = record.permissionTitle?.trim() || 'Uma ação aguarda aprovação';
  const detail = record.patterns?.length ? record.patterns.slice(0, 2).join(', ') : undefined;
  return {
    title: 'OpenCode precisa da tua aprovação',
    body: detail ? `${permissionTitle} — ${detail}` : permissionTitle,
    sound: true,
    categoryIdentifier: PERMISSION_PENDING_CATEGORY_ID,
    data: {
      type: 'permission-pending',
      sessionId: record.sessionId,
      requestID: record.requestID,
      permissionTitle,
      patterns: record.patterns ?? [],
      projectPath: record.projectPath,
      serverUrl: record.settings.serverUrl,
      username: record.settings.username,
      notifiedAt: record.notifiedAt,
    },
    ...(Platform.OS === 'android' ? { channelId: TASK_FINISHED_CHANNEL_ID } : {}),
  };
}

async function schedulePermissionPendingNotification(record: PendingPermissionNotificationRecord) {
  if (!canUseNotifications()) {
    return null;
  }
  return Notifications.scheduleNotificationAsync({
    content: buildPermissionPendingContent(record),
    trigger: null,
  });
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
        if (!await isCurrentPendingConnection(pending)) {
          delete pendingBySessionId[pending.sessionId];
          continue;
        }

        try {
          const settings: OpencodeConnectionSettings = {
            serverUrl: pending.settings.serverUrl,
            username: pending.settings.username,
            password: await getConnectionPassword(),
            directory: pending.projectPath,
          };
          const contract = (await detectServerContract(settings).catch(() => ({ contract: 'v1' as const }))).contract;
          const client = buildClient(settings, contract);
          const [statusesResponse, sessionsResponse] = await Promise.all([
            client.session.status(),
            client.session.list(),
          ]);
          const interactions = await listPendingInteractions(client).catch(() => undefined);

          const status = statusesResponse?.data?.[pending.sessionId];
          const pendingPermissions = (interactions?.permissions ?? []).filter(
            (item: PendingPermissionRequest) => item.sessionID === pending.sessionId,
          );

          if (pendingPermissions.length > 0) {
            const notified = await readPendingPermissionNotified();
            let changed = false;
            const stillPending = new Set(pendingPermissions.map((item) => item.id));

            for (const key of Object.keys(notified)) {
              if (notified[key]?.sessionId === pending.sessionId && !stillPending.has(notified[key].requestID)) {
                delete notified[key];
                changed = true;
              }
            }

            for (const item of pendingPermissions) {
              const key = pendingPermissionRecordKey(pending.sessionId, item.id);
              if (notified[key]) {
                continue;
              }
              const record: PendingPermissionNotificationRecord = {
                sessionId: pending.sessionId,
                requestID: item.id,
                permissionTitle: item.permission,
                patterns: item.patterns,
                projectPath: pending.projectPath,
                settings: { serverUrl: pending.settings.serverUrl, username: pending.settings.username },
                notifiedAt: Date.now(),
              };
              notified[key] = record;
              changed = true;
              await schedulePermissionPendingNotification(record);
            }

            if (changed) {
              await writePendingPermissionNotified(notified);
            }
            continue;
          }

          {
            const notified = await readPendingPermissionNotified();
            let changed = false;
            for (const key of Object.keys(notified)) {
              if (notified[key]?.sessionId === pending.sessionId) {
                delete notified[key];
                changed = true;
              }
            }
            if (changed) {
              await writePendingPermissionNotified(notified);
            }
          }

          if (status && status.type !== 'idle') {
            continue;
          }

          const session = sessionsResponse?.data?.find((item: { id: string; title?: string }) => item.id === pending.sessionId);
          if (!session) {
            delete pendingBySessionId[pending.sessionId];
            continue;
          }
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

async function configurePermissionPendingCategoryAsync() {
  if (!canUseNotifications()) {
    return;
  }
  await Notifications.setNotificationCategoryAsync(PERMISSION_PENDING_CATEGORY_ID, [
    {
      identifier: PERMISSION_ACTION_APPROVE,
      buttonTitle: 'Aprovar',
      options: { opensAppToForeground: true },
    },
    {
      identifier: PERMISSION_ACTION_REJECT,
      buttonTitle: 'Recusar',
      options: { opensAppToForeground: true, isDestructive: true },
    },
  ]).catch(() => undefined);
}

function isPermissionNotificationData(value: unknown): value is {
  sessionId: string;
  requestID: string;
  projectPath: string;
  serverUrl: string;
  username: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'permission-pending' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.requestID === 'string' &&
    typeof candidate.projectPath === 'string' &&
    typeof candidate.serverUrl === 'string' &&
    typeof candidate.username === 'string'
  );
}

async function handlePermissionNotificationResponse(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data;
  if (!isPermissionNotificationData(data)) {
    return;
  }
  if (response.actionIdentifier !== PERMISSION_ACTION_APPROVE && response.actionIdentifier !== PERMISSION_ACTION_REJECT) {
    return;
  }

  const reply: 'once' | 'reject' = response.actionIdentifier === PERMISSION_ACTION_APPROVE ? 'once' : 'reject';
  try {
    const settings: OpencodeConnectionSettings = {
      serverUrl: data.serverUrl,
      username: data.username,
      password: await getConnectionPassword(),
      directory: data.projectPath,
    };
    const contract = (await detectServerContract(settings).catch(() => ({ contract: 'v1' as const }))).contract;
    const client = buildClient(settings, contract);
    await replyToPendingPermission(client, data.requestID, reply);
  } catch {
    // Keep the notified record so the next background run can retry the alert.
    return;
  }
  await clearPendingPermissionNotification(data.sessionId, data.requestID);
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
  await configurePermissionPendingCategoryAsync();
  await registerBackgroundTaskAsync();
  Notifications.addNotificationResponseReceivedListener((response) => {
    void handlePermissionNotificationResponse(response);
  });
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
