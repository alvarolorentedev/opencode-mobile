import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { i18n } from '@/lib/i18n';
import type { OpencodeConnectionSettings, ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import { getEventSessionStatus, type OpencodeEvent } from '@/lib/opencode/events';
import { deriveTodosFromMessages, type SessionMessageRecord } from '@/lib/opencode/format';
import type { Session, SessionStatus, Todo } from '@/lib/opencode/types';
import { homeWidgetSupported, updateHomeWidget } from '@/lib/widgets';
import { mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import { readWidgetData, type WidgetInteractions } from '@/providers/services/widget-service';
import { recentWidgetSessions, widgetSession, widgetReply, widgetAttention, widgetPlan } from '@/providers/widget-content';
import { hideWidgetPreviews, type WidgetSnapshot } from '@/providers/widget-snapshot';
import { loadWidgetSnapshot, saveWidgetSnapshot } from '@/providers/widget-snapshot-storage';

type Input = {
  hydrated: boolean; connected: boolean; connectionScope: string;
  catalogClient: ScopedOpencodeClient; settings: OpencodeConnectionSettings; contract: ServerContract;
  isCurrentCatalogClient: (client: object) => boolean;
  showPreviews: boolean; language?: string; currentSessionId?: string; sessions: Session[];
  todoRecordsBySession: Record<string, SessionMessageRecord[]>; todosBySession: Record<string, Todo[]>;
  streamConnectedRef?: { current: boolean };
};

export function useWidgetState(input: Input) {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const snapshot = useRef<WidgetSnapshot | undefined>(undefined);
  const statuses = useRef<Record<string, SessionStatus>>({});
  const interactions = useRef<Record<string, WidgetInteractions>>({});
  const dirtyDirectories = useRef(new Set<string>());
  const seed = useRef(true);
  const generation = useRef(0);
  const initialized = useRef(false);
  const eventRevision = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const rerun = useRef(false);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const [busy, setBusy] = useState(false);
  const invalidate = useCallback(() => { generation.current++; clearTimeout(eventTimer.current); }, []);

  const publish = useCallback((next: WidgetSnapshot, operation: number) => {
    snapshot.current = next;
    writes.current = writes.current.catch(() => undefined).then(async () => {
      if (operation !== generation.current) return;
      // Check privacy at write time too: an older queued publish cannot restore excerpts.
      const value = { ...(latest.current.showPreviews ? next : hideWidgetPreviews(next)), language: latest.current.language };
      if (await saveWidgetSnapshot(value) && operation === generation.current) {
        await updateHomeWidget(latest.current.showPreviews ? value : hideWidgetPreviews(value));
      }
    });
    return writes.current;
  }, []);

  const publishPlan = useCallback(() => {
    const current = latest.current;
    if (!homeWidgetSupported || !current.hydrated || !current.connected || !current.currentSessionId || !snapshot.current || snapshot.current.connectionScope !== current.connectionScope) return;
    const session = current.sessions.find((entry) => entry.id === current.currentSessionId);
    const previous = snapshot.current.plan;
    // A cold transcript tail may not include its older todowrite record yet.
    const known = current.contract === 'v2' ? current.todoRecordsBySession[current.currentSessionId] : current.todosBySession[current.currentSessionId];
    if (!known && previous?.session.id === current.currentSessionId) return;
    const todos = current.currentSessionId ? (current.contract === 'v2'
      ? deriveTodosFromMessages(current.todoRecordsBySession[current.currentSessionId] ?? [])
      : current.todosBySession[current.currentSessionId] ?? []) : [];
    const plan = session ? widgetPlan(session, todos, current.connectionScope, i18n.t('chat:library.untitledChat'), Date.now(), current.showPreviews) : undefined;
    const comparable = (value: typeof plan) => value && { ...value, updatedAt: 0 };
    if (JSON.stringify(comparable(plan)) === JSON.stringify(comparable(previous))) return;
    void publish({ ...snapshot.current, plan }, generation.current);
  }, [publish]);

  const refreshWidgets = useCallback((full = false): Promise<void> => {
    if (full) { seed.current = true; eventRevision.current++; }
    const current = latest.current;
    if (!homeWidgetSupported || !current.hydrated || !current.connected || !initialized.current) return Promise.resolve();
    if (inFlight.current) { rerun.current = true; return inFlight.current; }
    const operation = generation.current;
    const revision = eventRevision.current;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const watchedDirectories = new Set([...dirtyDirectories.current, ...Object.entries(interactions.current)
          .filter(([, value]) => value.permissions.length || value.questions.length).map(([directory]) => directory)]);
        const data = await readWidgetData(current.catalogClient, current.settings, current.contract, {
          probeAllDirectories: seed.current || !current.streamConnectedRef?.current,
          watchedDirectories, previousInteractions: interactions.current,
          watchedSessionIds: new Set(Object.entries(statuses.current).filter(([, status]) => status.type !== 'idle').map(([id]) => id)),
        });
        if (operation !== generation.current || !current.isCurrentCatalogClient(current.catalogClient)) return;
        if (revision !== eventRevision.current) { rerun.current = true; return; }
        if (data.interactions) { seed.current = false; dirtyDirectories.current.clear(); }
        if (data.interactionsByDirectory) interactions.current = data.interactionsByDirectory;
        const now = Date.now();
        const scope = current.connectionScope;
        const untitled = i18n.t('chat:library.untitledChat');
        const showPreviews = latest.current.showPreviews;
        statuses.current = mergeSessionStatuses(statuses.current, data.statuses);
        const held = snapshot.current?.connectionScope === scope ? snapshot.current : undefined;
        const next: WidgetSnapshot = { ...held, updatedAt: held?.updatedAt ?? now, sessions: held?.sessions ?? [], connectionScope: scope, showPreviews };
        if (data.messages) {
          next.updatedAt = now;
          next.sessions = recentWidgetSessions(data.sessions).map((session) => ({
            ...widgetSession(session, scope, untitled, statuses.current[session.id]),
            ...widgetReply(data.messages![session.id] ?? [], i18n.t('share:attachments')),
          }));
        }
        if (data.interactions) next.attention = widgetAttention({ sessions: data.sessions, ...data.interactions,
          scope, untitled, now, showPreviews, currentSessionId: latest.current.currentSessionId });
        setBusy(Object.values(statuses.current).some((status) => status.type !== 'idle') || Boolean(next.attention?.total) || !data.messages || !data.interactions);
        await publish(showPreviews ? next : hideWidgetPreviews(next), operation);
        publishPlan();
      } catch (error) {
        if (operation === generation.current) setBusy(true);
        console.warn('Could not refresh widgets.', error);
      } finally {
        if (inFlight.current === promise) inFlight.current = undefined;
        if (rerun.current && operation === generation.current) {
          rerun.current = false;
          void refreshRef.current();
        }
      }
    })();
    inFlight.current = promise;
    return promise;
  }, [publish, publishPlan]);
  useLayoutEffect(() => { refreshRef.current = refreshWidgets; });

  useEffect(() => {
    if (!homeWidgetSupported || !input.hydrated) return;
    const operation = ++generation.current;
    snapshot.current = undefined; statuses.current = {}; inFlight.current = undefined; rerun.current = false; initialized.current = false;
    interactions.current = {}; dirtyDirectories.current.clear(); seed.current = true;
    clearTimeout(eventTimer.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- scope-owned polling state.
    setBusy(false);
    void (async () => {
      const stored = await loadWidgetSnapshot();
      if (operation !== generation.current) return;
      const next = stored?.connectionScope === input.connectionScope ? stored
        : { updatedAt: 0, sessions: [], connectionScope: input.connectionScope };
      await publish(input.showPreviews ? next : hideWidgetPreviews(next), operation);
      if (operation === generation.current) { initialized.current = true; publishPlan(); await refreshRef.current(); }
    })();
    return invalidate;
    // Privacy and connection status are reconciled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.hydrated, input.connectionScope, input.catalogClient, publish, invalidate, publishPlan]);

  useEffect(() => {
    if (!homeWidgetSupported || !input.hydrated) return;
    if (snapshot.current) void publish(input.showPreviews ? snapshot.current : hideWidgetPreviews(snapshot.current), generation.current);
    void refreshWidgets();
  }, [input.hydrated, input.connected, input.showPreviews, input.language, publish, refreshWidgets]);

  useEffect(() => { publishPlan(); }, [input.currentSessionId, input.sessions, input.todoRecordsBySession, input.todosBySession, input.showPreviews, publishPlan]);

  useEffect(() => {
    if (!homeWidgetSupported) return;
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refreshWidgets(true); });
    return () => listener.remove();
  }, [refreshWidgets]);

  const handleWidgetEvent = useCallback((event: OpencodeEvent) => {
    const status = getEventSessionStatus(event);
    if (status) statuses.current[status.sessionID] = status.status;
    const type = event.type === 'compatibility' ? event.payload.type : event.type;
    if (!/^(session\.|message\.|permission\.|question\.|form\.)/.test(type)) return;
    if (event.location?.directory) dirtyDirectories.current.add(event.location.directory);
    else seed.current = true;
    eventRevision.current++;
    clearTimeout(eventTimer.current);
    if (status || /^(permission\.|question\.|form\.)/.test(type)) void refreshRef.current();
    else eventTimer.current = setTimeout(() => { void refreshRef.current(); }, 1500);
  }, []);
  return { refreshWidgets, handleWidgetEvent, busy };
}
