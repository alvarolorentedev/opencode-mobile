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

let managedScope: string | undefined;
export function manageActivityCompletion(scope?: string) { managedScope = scope; }
export function isActivityCompletionManaged(scope?: string) { return Boolean(scope && scope === managedScope && activityNotifications?.suppressesCompletion()); }

export function updateActivityNotification(input: {
  sessionId: string; projectPath: string; connectionScope: string; title: string;
  action: string; count: number; key: string; active: boolean;
}) {
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
