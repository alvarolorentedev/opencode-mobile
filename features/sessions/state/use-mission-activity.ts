import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { MissionApprovals, MissionConnectionActivity, MissionExecution } from '@/shared/contracts/mission-control';
import type { ConnectionRecord, WorkspaceCatalog } from '@/shared/contracts/workspace';
import { buildClient, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { listPendingInteractions } from '@/shared/protocol/opencode/client/interactions';
import { getEventSessionStatus, type OpencodeEvent } from '@/shared/protocol/opencode/events';
import { isServerConnectedEvent } from '@/shared/protocol/opencode/server-data-events';
import type { Project, Session } from '@/shared/protocol/opencode/types';
import { getV2SessionSummary, listV2RunningSessionIds } from '@/shared/protocol/services/session-service';

const POLL_MS = 30_000;
const MAX_DIRECTORIES_PER_PASS = 12;
const MAX_SUMMARIES_PER_PASS = 16;
const terminal = { 'session.execution.succeeded': 'succeeded', 'session.execution.failed': 'failed',
  'session.execution.interrupted': 'interrupted' } as const;

type Observation = Pick<MissionConnectionActivity, 'approvals' | 'execution' | 'supplemental' | 'removed' | 'archivedProjects' | 'checkedAt'> & {
  client?: ScopedOpencodeClient;
  running?: MissionConnectionActivity['running'];
  partial?: boolean;
  streamLostAt?: number;
  statusFailed?: boolean;
};

const EMPTY: Observation = { approvals: {}, execution: {}, supplemental: [], removed: new Set() };
const requestIdentity = ({ id, sessionID }: { id: string; sessionID: string }) => ({ id, sessionID });

function executionEvent(event: OpencodeEvent): { id: string; execution: MissionExecution } | undefined {
  if (event.type === 'compatibility') return;
  const status = getEventSessionStatus(event);
  if (!status) return;
  const observedAt = Date.now();
  return { id: status.sessionID, execution: { type: terminal[event.type as keyof typeof terminal] ?? status.status.type,
    at: typeof event.created === 'number' && Number.isFinite(event.created) ? event.created : observedAt, observedAt } };
}

function directories(sessions: Session[], known: readonly string[], statuses: WorkspaceCatalog['statuses']) {
  const active = sessions.flatMap((session) => session.directory && statuses[session.id]?.type === 'busy' ? [session.directory] : []);
  return [...new Set([...active, ...sessions.flatMap((session) => session.directory ? [session.directory] : []), ...known])];
}

export function useMissionActivity(input: {
  entry: ConnectionRecord;
  client: ScopedOpencodeClient;
  connected: boolean;
  connectionFailed?: boolean;
  authorized: boolean;
  online: boolean;
  foreground: boolean;
  visible: boolean;
  catalog: WorkspaceCatalog;
  catalogCheckedAt?: number;
  catalogError?: boolean;
  knownDirectories: readonly string[];
  projects: Project[];
  reconnect: () => void;
}): MissionConnectionActivity {
  const { entry, client, connected, connectionFailed, authorized, online, foreground, visible, catalog, catalogCheckedAt, catalogError, knownDirectories, projects } = input;
  const supported = client.__opencode.contract === 'v2';
  const eligible = entry.enabled && connected && authorized && online && supported;
  const [observation, setObservation] = useState<Observation>(EMPTY);
  const observationRef = useRef(EMPTY);
  const latest = useRef(input);
  const enqueue = useRef<(scope?: string, catalog?: boolean) => void>(() => undefined);
  const dashboardSignal = useRef<AbortSignal | undefined>(undefined);
  useLayoutEffect(() => { latest.current = input; });

  const refresh = useCallback(() => {
    const state = latest.current;
    if (!state.online || !state.entry.enabled || !state.authorized) return;
    if (!state.connected) state.reconnect();
    else enqueue.current(undefined, true);
  }, []);

  useEffect(() => {
    if (!eligible || !foreground) return;
    const controller = new AbortController();
    const { signal } = controller;
    const unscoped = buildClient({ ...entry.settings, directory: '' }, 'v2', signal);
    const queued = new Set<string>();
    const urgent = new Set<string>();
    let full = false;
    let refreshCatalog = false;
    let moreSummaries = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let streamRevision = 0;
    const revisions = new Map<string, number>();
    const unavailableSummaries = new Map<string, number>();
    const current = () => !signal.aborted && latest.current.client === client;
    const update = (change: (value: Observation) => Observation) => {
      if (!current()) return;
      const previous = observationRef.current.client === client ? observationRef.current : { ...EMPTY, client };
      const next = change(previous);
      observationRef.current = next;
      setObservation(next);
    };
    const schedule = () => { if (!timer && !busy) timer = setTimeout(() => { timer = undefined; void flush(); }, 200); };
    const flush = async () => {
      if (!current()) return;
      busy = true;
      try {
        const state = latest.current;
        const sweep = full;
        const held = observationRef.current.client === client ? observationRef.current.supplemental : [];
        if (sweep) directories([...state.catalog.sessions, ...held], state.knownDirectories, state.catalog.statuses).forEach((scope) => queued.add(scope));
        const scopes = [...new Set([...urgent, ...queued])].slice(0, MAX_DIRECTORIES_PER_PASS);
        const readCatalog = refreshCatalog;
        scopes.forEach((scope) => { queued.delete(scope); urgent.delete(scope); });
        full = false;
        refreshCatalog = false;
        moreSummaries = false;
        if (readCatalog && state.visible && dashboardSignal.current) void state.catalog.refresh(dashboardSignal.current);
        if (!current()) return;
        const results: Record<string, MissionApprovals> = {};
        let index = 0;
        async function readDirectory() {
          while (current() && index < scopes.length) {
            const directory = scopes[index++];
            const revision = revisions.get(directory);
            const generation = streamRevision;
            const scoped = buildClient({ ...entry.settings, directory }, 'v2', signal);
            const requests = await listPendingInteractions(scoped).catch(() => undefined);
            if (generation !== streamRevision || revision !== revisions.get(directory)) {
              queued.add(directory);
              continue;
            }
            results[directory] = { permissions: requests?.permissions?.map(requestIdentity), questions: requests?.questions?.map(requestIdentity) };
          }
        }
        await Promise.all([readDirectory(), readDirectory()]);
        if (!current()) return;
        update((previous) => {
          const approvals = { ...previous.approvals, ...results };
          const checked = Object.values(approvals).some(({ permissions, questions }) => permissions || questions)
            || (!scopes.length && !state.knownDirectories.length && Boolean(state.catalogCheckedAt));
          return { ...previous, approvals, checkedAt: checked ? scopes.length || !previous.checkedAt ? Date.now() : previous.checkedAt : undefined };
        });
        const fresh = latest.current;
        const known = new Set([...fresh.catalog.sessions, ...observationRef.current.supplemental].map((session) => session.id));
        const candidates = new Set(Object.values(observationRef.current.approvals).flatMap(({ permissions, questions }) =>
          [...(permissions ?? []), ...(questions ?? [])].map((request) => request.sessionID)));
        const running = observationRef.current.running;
        const active = running && running.at >= (fresh.catalogCheckedAt ?? 0) ? running.ids
          : Object.keys(fresh.catalog.statuses).filter((id) => fresh.catalog.statuses[id].type === 'busy');
        active.forEach((id) => candidates.add(id));
        const missing = [...candidates].filter((id) => id !== 'global' && !known.has(id) && !observationRef.current.removed.has(id));
        const due = missing.filter((id) => (unavailableSummaries.get(id) ?? 0) <= Date.now());
        const supplemental: Session[] = [];
        let lookup = 0;
        const count = Math.min(due.length, MAX_SUMMARIES_PER_PASS);
        moreSummaries = due.length > count;
        async function readSummary() {
          while (current() && lookup < count) {
            const id = due[lookup++];
            const session = await getV2SessionSummary(unscoped, id).catch(() => undefined);
            if (session?.id === id && session.directory && !session.time.archived) supplemental.push(session);
            else unavailableSummaries.set(id, Date.now() + POLL_MS);
          }
        }
        await Promise.all([readSummary(), readSummary()]);
        const catalogIds = new Set(fresh.catalog.sessions.map(({ id }) => id));
        update((previous) => ({ ...previous, partial: supplemental.length < missing.length,
          supplemental: [...previous.supplemental.filter((session) => !catalogIds.has(session.id)
            && (candidates.has(session.id) || previous.execution[session.id]?.type === 'succeeded' || previous.execution[session.id]?.type === 'failed')),
            ...supplemental.filter(({ id }) => !previous.removed.has(id))] }));
      } finally {
        busy = false;
        if (current() && (full || refreshCatalog || moreSummaries || queued.size || urgent.size)) schedule();
      }
    };
    enqueue.current = (scope, withCatalog = false) => {
      if (!current()) return;
      if (scope) urgent.add(scope);
      else full = true;
      refreshCatalog ||= withCatalog;
      schedule();
    };
    const unobserveHealth = entry.events.observeHealth((healthy) => {
      streamRevision++;
      if (!healthy) {
        update((previous) => ({ ...previous, approvals: {}, checkedAt: undefined, running: undefined, execution: {}, streamLostAt: Date.now() }));
      } else if (!latest.current.visible && observationRef.current.streamLostAt) {
        void latest.current.catalog.refresh(signal);
      }
      enqueue.current(undefined, latest.current.visible);
    });
    const unobserve = entry.events.observe((event) => {
      if (event.type === 'compatibility') return;
      if (isServerConnectedEvent(event)) { enqueue.current(undefined, latest.current.visible); return; }
      const activity = executionEvent(event);
      if (activity) {
        update((previous) => {
          const old = previous.execution[activity.id];
          if (old && (old.at > activity.execution.at || (activity.execution.type === 'idle' && ['succeeded', 'failed', 'interrupted'].includes(old.type)))) return previous;
          return { ...previous, execution: { ...previous.execution, [activity.id]: activity.execution } };
        });
      }
      if (event.type === 'session.deleted' || event.type === 'session.archived') {
        const id = event.data?.sessionID;
        if (!id) return;
        update((previous) => ({ ...previous, removed: new Set([...previous.removed, id]),
          supplemental: previous.supplemental.filter((session) => session.id !== id) }));
      }
      if (event.type === 'session.unarchived') {
        update((previous) => ({ ...previous, removed: new Set([...previous.removed].filter((id) => id !== event.data.sessionID)) }));
      }
      if (event.type === 'project.updated' && event.data?.id && event.data?.time) {
        update((previous) => {
          const archivedProjects = new Set(previous.archivedProjects);
          if (event.data.time.archived) archivedProjects.add(event.data.id);
          else archivedProjects.delete(event.data.id);
          return { ...previous, archivedProjects };
        });
        enqueue.current(undefined, latest.current.visible);
      }
      const permission = event.type === 'permission.replied' ? event.data?.requestID : undefined;
      const question = event.type === 'form.replied' || event.type === 'form.cancelled' ? event.data?.id : undefined;
      if (permission || question) {
        streamRevision++;
        update((previous) => ({ ...previous, approvals: Object.fromEntries(Object.entries(previous.approvals).map(([scope, approvals]) => [
          scope, { permissions: approvals.permissions?.filter(({ id }) => id !== permission), questions: approvals.questions?.filter(({ id }) => id !== question) },
        ])) }));
      }
      if (/^(permission\.|form\.|session\.(created|moved|deleted|archived|unarchived))/.test(event.type)) {
        const directory = event.location?.directory;
        if (directory) revisions.set(directory, (revisions.get(directory) ?? 0) + 1);
        else streamRevision++;
        enqueue.current(event.location?.directory, event.type.startsWith('session.'));
      } else if (latest.current.visible && /^session\.(execution\.|renamed|model\.selected|agent\.selected)/.test(event.type)) {
        enqueue.current(event.location?.directory, true);
      }
    });
    const resumed = observationRef.current.client === client;
    update((previous) => ({ ...previous, approvals: {}, running: undefined,
      ...(resumed ? { checkedAt: undefined, execution: {}, streamLostAt: Date.now() } : {}) }));
    if (resumed && !latest.current.visible) void latest.current.catalog.refresh(signal);
    enqueue.current();
    return () => {
      controller.abort();
      clearTimeout(timer);
      unobserve();
      unobserveHealth();
      enqueue.current = () => undefined;
    };
  }, [client, eligible, entry.events, entry.settings, foreground]);

  const current = observation.client === client && authorized ? observation : EMPTY;
  const scopeKey = JSON.stringify(directories([...catalog.sessions, ...current.supplemental], knownDirectories, {}));
  useEffect(() => { if (eligible && foreground) enqueue.current(); }, [eligible, foreground, scopeKey]);

  useEffect(() => {
    if (!eligible || !foreground || !visible) return;
    const controller = new AbortController();
    dashboardSignal.current = controller.signal;
    const scoped = buildClient({ ...entry.settings, directory: '' }, 'v2', controller.signal);
    const poll = async () => {
      const state = latest.current;
      const old = observationRef.current;
      const healthy = entry.events.isHealthy();
      if (healthy && !(old.running?.ids.size || Object.values(state.catalog.statuses).some((status) => status.type === 'busy')
        || Object.values(old.execution).some(({ type }) => type === 'retry' || type === 'busy')
        || Object.values(old.approvals).some(({ permissions, questions }) => permissions?.length || questions?.length))) return;
      const at = Date.now();
      const ids = await listV2RunningSessionIds(scoped).catch(() => undefined);
      if (controller.signal.aborted || latest.current.client !== client) return;
      const next = observationRef.current.client === client ? observationRef.current : { ...EMPTY, client };
      const value = { ...next, running: ids && { ids: new Set(ids), at }, statusFailed: !ids };
      observationRef.current = value;
      setObservation(value);
      const retrying = Object.values(old.execution).some(({ type }) => type === 'retry');
      enqueue.current(undefined, !healthy || retrying);
    };
    refresh();
    const interval = setInterval(() => { void poll(); }, POLL_MS);
    return () => { controller.abort(); dashboardSignal.current = undefined; clearInterval(interval); };
  }, [client, eligible, entry.events, entry.settings, foreground, refresh, visible]);

  return useMemo(() => {
    const dirs = directories([...catalog.sessions, ...current.supplemental], knownDirectories, catalog.statuses);
    const incomplete = dirs.some((directory) => !current.approvals[directory]?.permissions || !current.approvals[directory]?.questions);
    const catalogStale = (catalogCheckedAt ?? 0) < (current.streamLostAt ?? 0);
    const phase = !entry.enabled || !online || !authorized || connectionFailed ? 'offline'
      : connected && !supported ? 'unsupported'
      : !connected ? catalogCheckedAt || catalogError ? 'offline' : 'checking'
      : !catalogCheckedAt && !catalogError ? 'checking'
      : catalogError && !current.checkedAt ? 'offline'
      : catalogError || catalogStale || incomplete || current.partial || current.statusFailed ? 'partial' : 'ready';
    return { ...current, phase, refresh, authorized, projects, revision: entry.revision,
      catalogAt: catalogError || current.statusFailed || catalogStale ? undefined : catalogCheckedAt };
  }, [authorized, catalog.sessions, catalog.statuses, catalogCheckedAt, catalogError, connected, connectionFailed, current, entry.enabled, entry.revision, knownDirectories, online, projects, refresh, supported]);
}
