import { listSessions, readSessionSettlement } from '@/shared/protocol/services/session-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { resolveConnectionCredentials } from '@/shared/storage/connection-profiles';
import { isActivityCompletionManaged } from '@/shared/platform/activity-notifications';
import { i18n } from '@/shared/i18n/index';
import { buildClient, detectServerContract, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { parsePendingNotificationSessions, pendingNotificationKey, serializePendingNotificationSessions, type PendingNotificationSession } from '@/features/notifications/model/notification-pending';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/shared/storage/keys';

const TASK_FINISHED_CHANNEL_ID = 'task-finished-silent';
const TASK_ATTENTION_CHANNEL_ID = 'task-attention';
const CHAT_COMPLETION_TASK_NAME = 'opencode-chat-completion-monitor';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;

export type CompletionOutcome = 'finished' | 'failed';

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

// Non-secret routing payload shared by completion and attention notifications.
// It mirrors the Android activity notification link so a tap opens the owning
// connection, project, and session.
export type NotificationRouteData = {
  sessionId: string;
  projectPath?: string;
  connectionScope?: string;
};

function routeData(input: NotificationRouteData): Record<string, string> {
  return {
    sessionId: input.sessionId,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.connectionScope ? { connectionScope: input.connectionScope } : {}),
  };
}

async function scheduleLocalNotification(title: string, body: string, data?: Record<string, string>) {
  if (!canUseNotifications()) {
    return null;
  }

  await configureNotificationChannelAsync();

  return Notifications.scheduleNotificationAsync({
    content: { ...buildTaskFinishedContent(title, body), ...(data ? { data } : {}) },
    trigger: Platform.OS === 'android' ? { channelId: TASK_FINISHED_CHANNEL_ID } : null,
  });
}

async function scheduleTaskFinishedNotification(input: {
  sessionTitle?: string;
  outcome: CompletionOutcome;
  data: Record<string, string>;
}) {
  const failed = input.outcome === 'failed';
  await scheduleLocalNotification(
    i18n.t(failed ? 'notifications:taskFinished.failedTitle' : 'notifications:taskFinished.title'),
    input.sessionTitle?.trim() || i18n.t(failed ? 'notifications:taskFinished.failedBodyFallback' : 'notifications:taskFinished.bodyFallback'),
    input.data,
  );
}

async function configureAttentionChannelAsync() {
  if (Platform.OS !== 'android' || !canUseNotifications()) {
    return;
  }

  await Notifications.setNotificationChannelAsync(TASK_ATTENTION_CHANNEL_ID, {
    name: i18n.t('notifications:attention.channel'),
    importance: AndroidImportance.DEFAULT,
  });
}

async function scheduleAttentionNotification(pending: PendingNotificationSession) {
  if (!canUseNotifications()) {
    return;
  }

  await configureAttentionChannelAsync();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: pending.sessionTitle?.trim() || i18n.t('notifications:activity.untitled'),
      body: i18n.t('notifications:activity.needsInput'),
      sound: Platform.OS !== 'android',
      data: routeData({ sessionId: pending.sessionId, projectPath: pending.projectPath, connectionScope: pending.connectionScope }),
    },
    trigger: Platform.OS === 'android' ? { channelId: TASK_ATTENTION_CHANNEL_ID } : null,
  });
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
          const contract = (await detectServerContract(settings).catch(() => ({ contract: 'v2' as const }))).contract;
          const client = buildClient(settings, contract);
          const { statuses, sessions } = await listSessions(client);

          const settlement = await readSessionSettlement(client, pending.sessionId, statuses[pending.sessionId]);
          if (settlement.state === 'running' || settlement.state === 'retrying' || settlement.state === 'unknown') continue;
          if (settlement.state === 'blocked') {
            await raisePendingAttention(pending.connectionScope, pending.sessionId, 'blocked').catch(() => undefined);
            continue;
          }

          const session = sessions.find((item: { id: string; title?: string }) => item.id === pending.sessionId);
          if (!session || settlement.state === 'aborted') {
            // A deleted session or an interrupted run is dropped without an alert.
            await completePendingNotification(key, pending);
            continue;
          }
          // Re-check ownership after the network read: a new prompt for this
          // session must not be notified or removed by the older monitor pass.
          await completePendingNotification(key, pending, () => notifyTaskFinished({
            sessionId: pending.sessionId,
            sessionTitle: session.title || pending.sessionTitle,
            projectPath: pending.projectPath,
            connectionScope: pending.connectionScope,
            outcome: settlement.state === 'failed' ? 'failed' : 'finished',
          }));
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
    importance: AndroidImportance.LOW,
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
// Completion carries a non-secret route payload so a tap can open the owning
// connection, project, and session.
export async function notifyTaskFinished(input: {
  sessionId: string;
  sessionTitle?: string;
  projectPath?: string;
  connectionScope?: string;
  outcome?: CompletionOutcome;
}) {
  if (isActivityCompletionManaged(input.connectionScope)) return;
  await scheduleTaskFinishedNotification({
    sessionTitle: input.sessionTitle,
    outcome: input.outcome ?? 'finished',
    data: routeData(input),
  });
}

// Records the last attention marker for a pending record and reports whether an
// alert should be posted now. Repeated polls while a task stays blocked return
// undefined, so a needs-input alert fires once per block episode; resolving the
// block clears the marker so a later block alerts again.
export async function claimPendingAttention(connectionScope: string, sessionId: string, key: string) {
  return withPendingSessions(async () => {
    const current = await readPendingNotificationSessions();
    const record = current[pendingNotificationKey(connectionScope, sessionId)];
    if (!record || record.attentionKey === key) return undefined;
    record.attentionKey = key;
    await writePendingNotificationSessions(current);
    return { ...record };
  });
}

export async function clearPendingAttention(connectionScope: string, sessionId: string) {
  return withPendingSessions(async () => {
    const current = await readPendingNotificationSessions();
    const record = current[pendingNotificationKey(connectionScope, sessionId)];
    if (!record?.attentionKey) return false;
    delete record.attentionKey;
    await writePendingNotificationSessions(current);
    return true;
  });
}

// Local, best-effort needs-input alert for a task already tracked by this
// connection. Callers must skip it while the app is foregrounded, where the
// in-app prompt is already visible.
export async function raisePendingAttention(connectionScope: string, sessionId: string, key: string) {
  const pending = await claimPendingAttention(connectionScope, sessionId, key);
  if (!pending) return false;
  await scheduleAttentionNotification(pending);
  return true;
}
