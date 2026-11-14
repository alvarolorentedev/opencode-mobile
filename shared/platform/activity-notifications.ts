import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { i18n } from '@/shared/i18n/index';
import { buildSessionLink } from '@/shared/contracts/session-link';
import { privateConnectionReference } from '@/shared/platform/private-connection-reference';

export type ActivityPhase = 'thinking' | 'needsInput' | 'retrying' | 'queued' | 'finished' | 'failed' | 'stopped' | 'reconnecting'
  | 'reading' | 'editing' | 'searching' | 'executing' | 'delegating';

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
  phase?: ActivityPhase;
  count?: number;
  agentCount?: number;
  toolCount?: number;
  completedSteps?: number;
  totalSteps?: number;
  filesChanged?: number;
  progressLabel?: string;
  agentsLabel?: string;
  toolsLabel?: string;
  filesLabel?: string;
  updatedLabel?: string;
  elapsedLabel?: string;
  workKeys?: string[];
};

const ios = Platform.OS === 'ios';
export const activityNotifications = !Constants.expoConfig?.extra?.e2eMode && (Platform.OS === 'android'
  || (ios && Constants.expoConfig?.extra?.iosLiveActivities === true && Constants.executionEnvironment !== 'storeClient'))
  ? requireOptionalNativeModule<{ update: (content: ActivityContent) => Promise<boolean>; stop: () => Promise<void>; waitUntilStopped: () => Promise<void>; suppressesCompletion: () => boolean }>('OpencodeActivity')
  : null;

export type ActivityWork = { sessionId: string; runId?: string };
export type ActivityInput = {
  sessionId: string; projectPath: string; connectionScope: string; title: string;
  action: string; count: number; key: string; active: boolean;
  phase?: ActivityPhase; agentCount?: number; toolCount?: number;
  progress?: { completed: number; total: number }; filesChanged?: number;
  work?: ActivityWork[];
  isCurrent?: () => boolean;
};
// Both platforms expose one activity surface; server observers share its ownership.
const activities = new Map<string, ActivityInput>();
const scopes = new Map<string, { isCurrent?: () => boolean }>();
let revision = 0;
let idleReconciled = false;
let writes: Promise<unknown> = Promise.resolve();
// Registration precedes each owner's first async read. An unread/failed/stale
// scope is not evidence that a restored aggregate activity has finished.
export function registerActivityNotificationScope(scope: string) {
  const owner = {};
  if (ios) { scopes.set(scope, owner); revision++; }
  return async () => {
    if (!ios || scopes.get(scope) !== owner) return;
    scopes.delete(scope);
    activities.delete(scope);
    revision++;
    await publishActivity(true, true);
  };
}
export function markActivityNotificationScopeReady(scope: string, isCurrent?: () => boolean) {
  const owner = scopes.get(scope);
  if (ios && owner) { owner.isCurrent = isCurrent; revision++; }
}
export function isActivityCompletionManaged(scope?: string) {
  return Boolean(!ios && scope && activities.get(scope)?.active && activityNotifications?.suppressesCompletion());
}
function boundedCount(value: number) { return Number.isFinite(value) ? Math.min(9999, Math.max(0, Math.floor(value))) : 0; }
function safePhase(phase?: ActivityPhase): ActivityPhase {
  switch (phase) {
    case 'needsInput': case 'retrying': case 'queued': case 'finished': case 'failed': case 'stopped': case 'reconnecting': return phase;
    case 'reading': case 'editing': case 'searching': case 'executing': case 'delegating': return phase;
    default: return 'thinking';
  }
}
function sumOptionalCount(active: ActivityInput[], selected: ActivityInput, key: 'agentCount' | 'toolCount' | 'filesChanged') {
  if (!active.length) return selected[key] === undefined || !Number.isFinite(selected[key]) ? undefined
    : key === 'filesChanged' ? boundedCount(selected[key]!) : 0;
  return active.every((entry) => entry[key] !== undefined && Number.isFinite(entry[key]))
    ? boundedCount(active.reduce((total, entry) => total + boundedCount(entry[key]!), 0)) : undefined;
}
function validProgress(progress?: ActivityInput['progress']) {
  return progress && Number.isSafeInteger(progress.completed) && Number.isSafeInteger(progress.total)
    && progress.completed >= 0 && progress.total > 0 && progress.completed <= progress.total && progress.total <= 9999
    ? { completed: progress.completed, total: progress.total } : undefined;
}
function aggregateProgress(active: ActivityInput[], selected: ActivityInput) {
  if (!active.length) return validProgress(selected.progress);
  if (!active.every((entry) => validProgress(entry.progress))) return undefined;
  return validProgress(active.reduce((sum, entry) => ({ completed: sum.completed + entry.progress!.completed,
    total: sum.total + entry.progress!.total }), { completed: 0, total: 0 }));
}
function publishActivity(stopWhenIdle = false, forceStop = false, submittedIsCurrent?: () => boolean): Promise<boolean> {
  const publish = async () => {
    const submittedRevision = revision;
    const all = [...activities.values()].filter((entry) => !ios || entry.isCurrent?.() !== false);
    const isCurrent = () => !ios || (submittedRevision === revision && submittedIsCurrent?.() !== false
      && all.every((entry) => entry.isCurrent?.() !== false));
    if (!isCurrent()) return false;
    const active = all.filter((entry) => entry.active);
    if (ios && !active.length && ![...scopes.values()].every((owner) => owner.isCurrent?.())) return false;
    const selected = (ios ? active.find((entry) => entry.phase === 'needsInput') : undefined)
      ?? active.at(-1) ?? (stopWhenIdle ? undefined : all.at(-1));
    if (ios && !active.length && idleReconciled && !forceStop) return false;
    if (!selected) {
      await activityNotifications?.stop();
      if (ios && isCurrent()) idleReconciled = true;
      return false;
    }
    const metricsKnown = [...scopes.values()].every((owner) => owner.isCurrent?.())
      && [...activities.values()].every((entry) => entry.isCurrent?.() !== false);
    const result = await renderActivity({ ...selected,
      count: active.reduce((total, entry) => total + Math.max(1, ios ? boundedCount(entry.count) : entry.count), 0),
      ...(ios ? { agentCount: metricsKnown ? sumOptionalCount(active, selected, 'agentCount') : undefined,
        toolCount: metricsKnown ? sumOptionalCount(active, selected, 'toolCount') : undefined,
        filesChanged: metricsKnown ? sumOptionalCount(active, selected, 'filesChanged') : undefined,
        progress: metricsKnown ? aggregateProgress(active, selected) : undefined } : {}),
    }, active, isCurrent);
    if (ios && !active.length && result && isCurrent()) idleReconciled = true;
    return result;
  };
  const pending = writes.then(publish, publish);
  writes = pending.catch(() => undefined);
  return pending;
}
export function stopActivityNotification(scope: string, isCurrent?: () => boolean) {
  if (ios && isCurrent?.() === false) return Promise.resolve();
  activities.delete(scope);
  revision++;
  return publishActivity(true, false, isCurrent).then(() => undefined);
}
export function updateActivityNotification(input: ActivityInput) {
  if (ios && input.isCurrent?.() === false) return Promise.resolve(false);
  activities.delete(input.connectionScope);
  activities.set(input.connectionScope, input);
  revision++;
  if (ios && input.active) idleReconciled = false;
  return publishActivity(false, false, input.isCurrent);
}
async function opaqueHash(value: string) {
  const reference = await privateConnectionReference(value);
  if (!/^activity-sha256:[a-f0-9]{64}$/.test(reference)) throw new Error('Invalid private activity reference.');
  return reference.slice(16);
}
async function renderActivity(input: ActivityInput, active: ActivityInput[], isCurrent: () => boolean) {
  const title = input.title.trim() || i18n.t('notifications:activity.untitled');
  const destination = {
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    connectionScope: ios ? await privateConnectionReference(input.connectionScope) : input.connectionScope,
  };
  if (!isCurrent()) return false;
  const workKeys: string[] = [];
  if (ios) {
    for (const entry of active) {
      for (const work of entry.work ?? [{ sessionId: entry.sessionId }]) {
        const task = await opaqueHash(JSON.stringify(['activity-task', entry.connectionScope, work.sessionId]));
        if (!isCurrent()) return false;
        const run = work.runId ? await opaqueHash(JSON.stringify(['activity-run', entry.connectionScope, work.sessionId, work.runId])) : undefined;
        if (!isCurrent()) return false;
        workKeys.push(run ? `${task}:${run}` : task);
      }
    }
  }
  const configuredScheme = Constants.expoConfig?.scheme;
  const scheme = (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) || 'opencodemobile';
  const link = ios ? buildSessionLink(destination, scheme) : buildSessionLink(destination);
  const count = boundedCount(input.count);
  const phase = safePhase(input.phase);
  const progress = validProgress(input.progress);
  return activityNotifications?.update({
    title: ios ? 'OpenCode' : input.active && input.count > 1 ? i18n.t('notifications:activity.tasks', { count: input.count }) : title,
    body: ios ? i18n.t(`notifications:activity.${phase}`) : input.active && input.count > 1 ? `${title} · ${input.action}` : input.action,
    link, key: ios ? 'activity-aggregate' : input.key, active: input.active,
    chip: ios && !input.active && ['finished', 'failed', 'stopped'].includes(phase) ? i18n.t(`notifications:activity.${phase}`)
      : ios && count > 1 ? i18n.t('notifications:activity.tasks', { count }) : i18n.t('notifications:activity.working'),
    ...(ios ? { phase, count, workKeys: [...new Set(workKeys)].sort(),
      ...(input.agentCount === undefined ? {} : { agentCount: boundedCount(input.agentCount), agentsLabel: i18n.t('notifications:activity.agentsLabel', { count: boundedCount(input.agentCount) }) }),
      ...(input.toolCount === undefined ? {} : { toolCount: boundedCount(input.toolCount), toolsLabel: i18n.t('notifications:activity.toolsLabel', { count: boundedCount(input.toolCount) }) }),
      ...(input.filesChanged === undefined ? {} : { filesChanged: boundedCount(input.filesChanged), filesLabel: i18n.t('notifications:activity.filesLabel', { count: boundedCount(input.filesChanged) }) }),
      ...(progress ? { completedSteps: progress.completed, totalSteps: progress.total, progressLabel: i18n.t('notifications:activity.progressLabel', progress) } : {}),
      updatedLabel: i18n.t('notifications:activity.updatedLabel'), elapsedLabel: i18n.t('notifications:activity.elapsedLabel'),
    } : {}),
    stopLabel: i18n.t('notifications:activity.stopMonitoring'),
    channelLabel: i18n.t('notifications:activity.channel'),
    pausedLabel: i18n.t(ios ? 'notifications:activity.updatesPaused' : 'notifications:activity.paused'),
  }) ?? Promise.resolve(false);
}
