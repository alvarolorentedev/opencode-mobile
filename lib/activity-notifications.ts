import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { i18n } from '@/lib/i18n';
import { buildSessionLink } from '@/lib/session-link';

type ActivityContent = {
  title: string;
  body: string;
  link: string;
  chip: string;
  stopLabel: string;
  channelLabel: string;
  pausedLabel: string;
  key: string;
  active: boolean;
};

export const activityNotifications = Platform.OS === 'android' && !Constants.expoConfig?.extra?.e2eMode
  ? requireOptionalNativeModule<{ update: (content: ActivityContent) => Promise<boolean>; stop: () => Promise<void>; waitUntilStopped: () => Promise<void>; suppressesCompletion: () => boolean }>('OpencodeActivity')
  : null;

type ActivityInput = {
  sessionId: string; projectPath: string; connectionScope: string; title: string;
  action: string; count: number; key: string; active: boolean;
};
// Android exposes one activity surface; server observers share its ownership.
const activities = new Map<string, ActivityInput>();
let writes: Promise<unknown> = Promise.resolve();
export function isActivityCompletionManaged(scope?: string) {
  return Boolean(scope && activities.get(scope)?.active && activityNotifications?.suppressesCompletion());
}
function publishActivity(stopWhenIdle = false): Promise<boolean> {
  const publish = async () => {
    const all = [...activities.values()];
    const active = all.filter((entry) => entry.active);
    const selected = active.at(-1) ?? (stopWhenIdle ? undefined : all.at(-1));
    if (!selected) { await activityNotifications?.stop(); return false; }
    return renderActivity({ ...selected, count: active.reduce((total, entry) => total + Math.max(1, entry.count), 0) });
  };
  const pending = writes.then(publish, publish);
  writes = pending.catch(() => undefined);
  return pending;
}
export function stopActivityNotification(scope: string) {
  activities.delete(scope);
  return publishActivity(true).then(() => undefined);
}
export function updateActivityNotification(input: ActivityInput) {
  activities.delete(input.connectionScope);
  activities.set(input.connectionScope, input);
  return publishActivity();
}
function renderActivity(input: ActivityInput) {
  const title = input.title.trim() || i18n.t('notifications:activity.untitled');
  const link = buildSessionLink({
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    connectionScope: input.connectionScope,
  });
  return activityNotifications?.update({
    title: input.active && input.count > 1 ? i18n.t('notifications:activity.tasks', { count: input.count }) : title,
    body: input.active && input.count > 1 ? `${title} · ${input.action}` : input.action,
    link, key: input.key, active: input.active,
    chip: i18n.t('notifications:activity.working'),
    stopLabel: i18n.t('notifications:activity.stopMonitoring'),
    channelLabel: i18n.t('notifications:activity.channel'),
    pausedLabel: i18n.t('notifications:activity.paused'),
  }) ?? Promise.resolve(false);
}
