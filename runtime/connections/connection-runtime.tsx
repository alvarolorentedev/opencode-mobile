import { buildClient, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppState } from 'react-native';
import { createConnection } from '@/runtime/connections/create-connection';
import { useAppCore, useAppStore } from '@/runtime/core';
import { useActivityNotifications } from '@/features/notifications/runtime';
import type { SendingState } from '@/shared/contracts/prompt-actions';
import { idleConnection } from './idle-connection';
import { projectsOptions } from '@/features/projects/runtime';
import { useConnectionQueryIdentity, useQueryForeground } from '@/shared/server-data/client';
import { readSessionStats } from '@/shared/protocol/services/session-stats';
import type { SessionStatsSource } from '@/shared/server-data/session-stats';
import { useActiveSessions, useMissionActivity } from '@/features/sessions/runtime';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import { workspaceKey, type ConnectionRecord, type WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Project } from '@/shared/protocol/opencode/types';

const EMPTY_PROJECTS: Project[] = [];

// i18next's TFunction no longer accepts a plain options record, and the protocol
// layer must not type itself against i18next generics, so adapt at this boundary.
// The protocol layer only ever asks for plain strings, never key details.
function connectionTranslator(t: TFunction) {
  return (key: string, options?: Record<string, unknown>): string =>
    (options ? t(key, options as never) : t(key)) as string;
}

const readIdle = () => idleConnection;
const noSubscription = () => () => {};
const IDLE: SendingState = { active: false };

export function useConnectionRegistryBinding(setup: ConnectSetup, updateSettings: (id: string, settings: OpencodeConnectionSettings) => void, hydrated: boolean) {
  const { connections } = useAppCore();
  const { t } = useTranslation();
  const { phase, prepareSettings } = setup;
  useLayoutEffect(() => {
    connections.setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => connections.setForeground(state === 'active'));
    return () => { subscription.remove(); connections.dispose(); };
  }, [connections]);
  useLayoutEffect(() => {
    connections.configure({ setup: { phase, prepareSettings }, translate: connectionTranslator(t), hydrated, updateSettings, createManager: createConnection });
  }, [connections, hydrated, phase, prepareSettings, t, updateSettings]);
}

export function useConnectionDemand(activeId: string | undefined) {
  const { connections } = useAppCore();
  const foreground = useQueryForeground();
  useLayoutEffect(() => { connections.setDemand(activeId, foreground); }, [activeId, connections, foreground]);
}

function useManagedConnection(entry: ConnectionRecord) {
  const { connections, commands } = useAppCore();
  const managerForThisId = useCallback(() => connections.get(entry.id), [connections, entry.id]);
  const manager = useSyncExternalStore(connections.subscribe, managerForThisId, managerForThisId);
  const state = useSyncExternalStore(manager?.subscribe ?? noSubscription, manager?.getState ?? readIdle, readIdle);
  const connect = useCallback(() => commands.connection.connect(entry.id), [commands.connection, entry.id]);
  return useMemo(() => ({
    connection: entry.enabled ? state.connection : idleConnection.connection,
    serverContract: state.contract,
    connect,
    manager,
  }), [connect, entry.enabled, manager, state.connection, state.contract]);
}

export function ConnectionCatalog({ entry, online, onCatalog, libraryVisible, missionVisible, demanded }: {
  entry: ConnectionRecord;
  online: boolean;
  libraryVisible: boolean;
  missionVisible: boolean;
  demanded: boolean;
  onCatalog: (entry: ConnectionRecord, catalog: WorkspaceCatalog) => void;
}) {
  const lifecycle = useManagedConnection(entry);
  const catalogClient = useMemo(() => lifecycle.manager?.getCatalogClient() ?? buildClient({ ...entry.settings, directory: '' }, lifecycle.serverContract),
    [entry.settings, lifecycle.manager, lifecycle.serverContract]);
  const identity = useConnectionQueryIdentity(entry);
  const foreground = useQueryForeground();
  const sessions = useActiveSessions({ identity, catalogClient, connected: entry.enabled && lifecycle.connection.status === 'connected', currentSessionId: undefined, hideSubagentChats: false, visible: demanded && entry.enabled && foreground && libraryVisible });
  const sessionCatalog = useMemo<WorkspaceCatalog>(() => ({ sessions: sessions.catalogSessions, statuses: sessions.catalogStatuses, refresh: sessions.refreshActiveSessions, removeSession: sessions.removeSession }), [sessions.catalogSessions, sessions.catalogStatuses, sessions.refreshActiveSessions, sessions.removeSession]);
  const projects = useQuery({ ...projectsOptions(identity, catalogClient),
    enabled: entry.enabled && online && foreground && lifecycle.connection.status === 'connected' && lifecycle.serverContract === 'v2' }).data ?? EMPTY_PROJECTS;
  const knownDirectories = useMemo(() => projects.flatMap(({ worktree, sandboxes }) => [worktree, ...(sandboxes ?? [])]).filter(Boolean), [projects]);
  const connected = lifecycle.connection.status === 'connected';
  const { commands: { workspace } } = useAppCore();
  const focusedKey = useAppStore(({ registry: { focus } }) => focus?.connectionId === entry.id ? workspace.resolveKey(focus) : undefined);
  const defaultKey = workspaceKey({ connectionId: entry.id, projectPath: entry.projects[0] ?? '' });
  const currentSessionId = useAppStore(({ selection }) => focusedKey ? selection[focusedKey]?.currentSessionId : undefined);
  const prompt = useAppStore((state) => state.prompt[focusedKey ?? defaultKey]);
  const manager = lifecycle.manager;
  const isStreamConnected = useCallback(() => manager?.realtime.getStatus() === 'connected', [manager]);
  const handleActivity = useActivityNotifications({
    catalogClient, settings: entry.settings, contract: lifecycle.serverContract, connectionScope: identity.connectionScope,
    connected: entry.enabled && connected, currentSessionId, sessions: sessions.catalogSessions,
    sendingState: prompt?.sending ?? IDLE, promptError: prompt?.error, autoApprove: entry.preferences.autoApprove,
    isStreamConnected,
  });
  useEffect(() => connected ? manager?.events.observe(handleActivity) : undefined, [connected, handleActivity, manager]);
  const authorized = lifecycle.connection.kind !== 'auth' && lifecycle.connection.kind !== 'entitlement';
  const statsAvailable = entry.enabled && online && connected && authorized && lifecycle.serverContract === 'v2';
  const stats = useMemo<SessionStatsSource | undefined>(() => statsAvailable ? {
    identity, read: (range, project, signal, timezone) => readSessionStats(catalogClient, range, project, signal, timezone),
  } : undefined, [catalogClient, identity, statsAvailable]);
  const mission = useMissionActivity({ entry, events: lifecycle.manager?.events, client: catalogClient, connected: lifecycle.connection.status === 'connected',
    connectionFailed: lifecycle.connection.status === 'error',
    authorized,
    online, foreground, visible: Boolean(missionVisible), catalog: sessionCatalog, catalogCheckedAt: sessions.catalogCheckedAt,
    catalogError: sessions.catalogError, knownDirectories, projects, reconnect: lifecycle.connect });
  const catalog = useMemo(() => ({ ...sessionCatalog, mission: { ...mission, stats } }), [sessionCatalog, mission, stats]);
  useLayoutEffect(() => { onCatalog(entry, catalog); }, [catalog, entry, onCatalog]);
  return null;
}
