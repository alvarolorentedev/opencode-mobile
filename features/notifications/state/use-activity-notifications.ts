import { getEventSessionStatus } from '@/shared/protocol/opencode/events';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { stringField } from '@/shared/protocol/opencode/v2/fields';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { activityNotifications, stopActivityNotification, updateActivityNotification } from '@/shared/platform/activity-notifications';
import { i18n } from '@/shared/i18n/index';
import { clearPendingAttention, clearPendingTaskFinishedNotification, raisePendingAttention, trackPendingTaskFinishedNotification } from '@/features/notifications/services/notifications';
import type { OpencodeConnectionSettings, ScopedOpencodeClient, ServerContract } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { getSessionActivities, selectDisplayedActivity, type SessionActivity } from '@/features/notifications/model/activity-notification-state';
import { readActivitySnapshot } from '@/features/notifications/services/activity-service';
import { mergeSessionStatuses } from '@/features/sessions/runtime';

type Input = {
  catalogClient: ScopedOpencodeClient;
  settings: OpencodeConnectionSettings;
  contract: ServerContract;
  connectionScope: string;
  connected: boolean;
  currentSessionId?: string;
  sessions: Session[];
  sendingState: { active: boolean; sessionId?: string };
  promptError?: { sessionId?: string; occurredAt: number };
  // True while the global SSE stream is healthy. When it is, interaction reads
  // can be limited to directories with running work because events reconcile
  // other projects directly.
  streamConnectedRef: { current: boolean };
};

function eventData(event: OpencodeEvent): Record<string, unknown> {
  return event.type === 'compatibility' ? {} : ('data' in event ? event.data as Record<string, unknown> : {});
}

// A permission or question request that should alert a backgrounded user.
// Compatibility (v1) events are handled by the Android activity snapshot.
function attentionTarget(event: OpencodeEvent): { sessionId?: string; key: string } {
  const type = event.type === 'compatibility' ? event.payload.type : event.type;
  const data = eventData(event);
  if (type === 'permission.asked' || type === 'question.asked') {
    return { sessionId: stringField(data.sessionID), key: 'blocked' };
  }
  if (type === 'form.created') {
    const form = data.form as Record<string, unknown> | undefined;
    return { sessionId: stringField(form?.sessionID), key: 'blocked' };
  }
  return { key: 'blocked' };
}

function settledSession(event: OpencodeEvent): string | undefined {
  const type = event.type === 'compatibility' ? event.payload.type : event.type;
  if (type !== 'permission.replied' && type !== 'form.replied' && type !== 'form.cancelled') return undefined;
  const data = eventData(event);
  return stringField(data.sessionID) ?? stringField((data.form as Record<string, unknown> | undefined)?.sessionID);
}

export function useActivityNotifications(input: Input) {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const refreshRef = useRef<(immediate?: boolean, delay?: number) => void>(() => undefined);
  const eventStatuses = useRef<Record<string, SessionStatus>>({});
  const eventRevision = useRef(0);

  useEffect(() => {
    if (!activityNotifications || !input.connected) return;
    const scope = input.connectionScope;
    const catalogClient = input.catalogClient;
    let cancelled = false;
    let inFlight = false;
    let rerun = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let displayed: SessionActivity | undefined;
    let previousIds = new Set<string>();
    let generation = 0;
    let monitoring = false;
    const tracked = new Map<string, number>();
    const watched = new Set<string>();
    const runPrefix = `${scope}:${Date.now()}`;
    eventStatuses.current = {};

    function action(activity: SessionActivity) {
      return activity.state === 'thinking' && activity.tool ? activity.tool : i18n.t(`notifications:activity.${activity.state}`);
    }
    async function publish(activity: SessionActivity, count: number) {
      if (cancelled) return false;
      return updateActivityNotification({
        sessionId: activity.session.id, projectPath: activity.session.directory || '', connectionScope: scope,
        title: activity.session.title || i18n.t('notifications:activity.untitled'),
        action: action(activity), count, key: `${runPrefix}:${generation}`, active: activity.active,
      });
    }
    async function refresh() {
      if (cancelled) return;
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      clearTimeout(timer);
      try {
        const permissionGranted = (await Notifications.getPermissionsAsync()).granted;
        if (cancelled) return;
        if (!permissionGranted) {
          monitoring = false;
          await stopActivityNotification(scope);
          return;
        }
        if (AppState.currentState !== 'active' && !monitoring) return;
        const current = latest.current;
        const localSending = current.sendingState.active
          ? current.sessions.find((session) => session.id === current.sendingState.sessionId) : undefined;
        if (localSending && !displayed && AppState.currentState === 'active') {
          generation++;
          displayed = { session: localSending, active: true, state: 'thinking' };
          previousIds.add(localSending.id);
          watched.add(localSending.id);
          monitoring = await publish(displayed, 1);
        }
        const revision = eventRevision.current;
        const snapshot = await readActivitySnapshot(
          catalogClient,
          current.settings,
          current.contract,
          watched,
          !current.streamConnectedRef.current,
        );
        if (cancelled) return;
        if (revision !== eventRevision.current) { rerun = true; return; }
        snapshot.statuses = mergeSessionStatuses(eventStatuses.current, {
          ...Object.fromEntries(snapshot.sessions.map((session) => [session.id, { type: 'idle' as const }])),
          ...snapshot.statuses,
        });
        eventStatuses.current = snapshot.statuses;
        const activities = getSessionActivities(snapshot);
        const sendingState = latest.current.sendingState;
        if (sendingState.active && sendingState.sessionId) {
          const sending = activities.find((item) => item.session.id === sendingState.sessionId);
          const sendingSession = latest.current.sessions.find((session) => session.id === sendingState.sessionId);
          if (sending) { sending.active = true; sending.state = 'thinking'; }
          else if (sendingSession) activities.push({ session: sendingSession, active: true, state: 'thinking' });
        }
        const active = activities.filter((item) => item.active);
        const ids = new Set(active.map((item) => item.session.id));
        if (active.some((item) => !previousIds.has(item.session.id))) generation++;
        previousIds = ids;
        for (const activity of active) {
          const session = activity.session;
          watched.add(session.id);
          if (!tracked.has(session.id)) {
            const record = await trackPendingTaskFinishedNotification({
              sessionId: session.id, sessionTitle: session.title, projectPath: session.directory || '', connectionScope: scope,
              settings: { serverUrl: current.settings.serverUrl, username: current.settings.username }, requestedAt: Date.now(),
            }, true);
            if (cancelled) return;
            tracked.set(session.id, record.requestedAt);
          }
        }
        for (const [id, requestedAt] of tracked) {
          if (!ids.has(id)) {
            await clearPendingTaskFinishedNotification(scope, id, requestedAt);
            if (cancelled) return;
            tracked.delete(id);
            watched.delete(id);
          }
        }
        const selected = selectDisplayedActivity(activities, latest.current.currentSessionId);
        if (selected) {
          displayed = selected;
          monitoring = await publish(selected, active.length);
        } else if (displayed) {
          const finished = activities.find((item) => item.session.id === displayed!.session.id)
            ?? { ...displayed, active: false, state: 'stopped' as const };
          if (latest.current.promptError?.sessionId === finished.session.id) finished.state = 'failed';
          await publish(finished, 0);
          monitoring = false;
          displayed = undefined;
        }
      } catch (error) {
        if (!cancelled && displayed && monitoring) {
          await updateActivityNotification({
            sessionId: displayed.session.id, projectPath: displayed.session.directory || '', connectionScope: scope,
            title: displayed.session.title, action: i18n.t('notifications:activity.reconnecting'),
            count: previousIds.size, key: `${runPrefix}:${generation}`, active: true,
          }).catch(() => undefined);
        }
        console.warn('Could not refresh activity notification.', error);
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (rerun) { rerun = false; void refresh(); }
          else if (AppState.currentState === 'active' || monitoring) timer = setTimeout(() => void refresh(), monitoring ? 5000 : 20000);
        }
      }
    }
    const scheduleRefresh = (immediate = false, delay = 250) => {
      if (immediate) { generation++; void refresh(); return; }
      if (cancelled || eventTimer) return;
      eventTimer = setTimeout(() => { eventTimer = undefined; void refresh(); }, delay);
    };
    refreshRef.current = scheduleRefresh;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
      else if (!monitoring) clearTimeout(timer);
    });
    void refresh();
    return () => {
      cancelled = true;
      refreshRef.current = () => undefined;
      clearTimeout(timer);
      clearTimeout(eventTimer);
      subscription.remove();
      void stopActivityNotification(scope).catch(() => undefined);
    };
  }, [input.catalogClient, input.connected, input.connectionScope]);

  useEffect(() => {
    refreshRef.current(input.sendingState.active);
  }, [input.sendingState.active, input.sendingState.sessionId]);

  useEffect(() => { refreshRef.current(); }, [input.currentSessionId, input.promptError]);

  return useCallback((event: OpencodeEvent) => {
    if (!latest.current.connected) return;
    const status = getEventSessionStatus(event);
    if (status) { eventStatuses.current[status.sessionID] = status.status; eventRevision.current++; }
    const type = event.type === 'compatibility' ? event.payload.type : event.type;
    if (/^(permission\.|question\.|form\.|session\.(created|deleted))/.test(type)) eventRevision.current++;
    // Locally observed needs-input alert. It is best effort: it fires only
    // while JS is alive and only when the app is not already showing the prompt.
    const target = attentionTarget(event);
    if (target.sessionId && AppState.currentState !== 'active') {
      void raisePendingAttention(latest.current.connectionScope, target.sessionId, target.key).catch(() => undefined);
    }
    const resolved = settledSession(event);
    if (resolved) void clearPendingAttention(latest.current.connectionScope, resolved).catch(() => undefined);
    if (/^(session\.|message\.|permission\.|question\.|form\.)/.test(type)) refreshRef.current(false, /^(message\.|session\.(text|reasoning|tool))/.test(type) ? 1000 : 250);
  }, []);
}
