import { createProjectTerminal } from '@/features/terminal/runtime';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { getRequestHeaders, withOidcAuthorizationObject, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { projectQueryKey } from '@/shared/server-data/keys';

import type { CommandContext } from './context';

type TerminalController = ReturnType<typeof createProjectTerminal>;
type TerminalScope = {
  key: string;
  target: WorkspaceTarget;
  projectPath: string;
  queryKey: ReturnType<typeof projectQueryKey>;
  controller: TerminalController;
};

type Credentials = {
  settings: OpencodeConnectionSettings;
  headers?: Record<string, string>;
  token?: string;
  unsubscribe?: () => void;
};

export function createTerminalRuntime({ store, queryClient, connections }: CommandContext) {
  const credentials = new Map<string, Credentials>();
  const scopes = new Map<string, TerminalScope>();
  const listeners = new Set<() => void>();
  let views: TerminalScope[] = [];
  let stop: (() => void) | undefined;
  let previousForeground = connections.environment.isForeground();
  const notify = () => { for (const listener of listeners) listener(); };

  function dropCredentials(connectionId: string) {
    credentials.get(connectionId)?.unsubscribe?.();
    credentials.delete(connectionId);
  }

  function headersFor(connectionId: string, settings: OpencodeConnectionSettings) {
    const previous = credentials.get(connectionId);
    if (previous?.settings === settings) return previous.headers;
    dropCredentials(connectionId);

    const baseHeaders = getRequestHeaders(settings);
    const current: Credentials = { settings, headers: baseHeaders };
    credentials.set(connectionId, current);
    const oidc = settings.oidc;
    if (!oidc) return current.headers;
    void import('@/shared/auth/oidc/session').then((auth) => {
      if (credentials.get(connectionId) !== current) return;
      const applyToken = (token?: string) => {
        if (credentials.get(connectionId) !== current || token === current.token) return;
        current.token = token;
        current.headers = withOidcAuthorizationObject(baseHeaders, token, oidc);
        reconcile();
      };
      const loadToken = () => { void auth.getOidcAccessToken(settings, oidc).then(applyToken, () => applyToken()); };
      current.unsubscribe = auth.subscribeOidcSession(loadToken);
      loadToken();
    }).catch(() => undefined);
    return current.headers;
  }

  function reconcile() {
    if (!stop) return;
    const { registry, selection } = store.getState();
    const enabled = new Set<string>();
    const active = new Set<string>();
    const foreground = connections.environment.isForeground();
    const online = connections.environment.isOnline();
    const changedForeground = foreground !== previousForeground;
    previousForeground = foreground;
    let changed = false;

    for (const entry of registry.connections) {
      const manager = entry.enabled ? connections.get(entry.id) : undefined;
      if (!manager) {
        for (const projectPath of entry.projects) {
          const key = workspaceKey({ connectionId: entry.id, projectPath });
          const scope = scopes.get(key);
          if (!scope) continue;
          active.add(key);
          scope.controller.pause();
          if (changedForeground) scope.controller.setForeground(foreground);
        }
        continue;
      }
      enabled.add(entry.id);
      const { contract } = manager.getState();
      const identity = { connectionId: entry.id, connectionScope: getConnectionScope(entry.settings), authRevision: entry.authRevision ?? 0 };
      const headers = headersFor(entry.id, entry.settings);
      for (const path of entry.projects) {
        const key = workspaceKey({ connectionId: entry.id, projectPath: path });
        const projectPath = selection[key]?.activeProjectPath ?? path;
        active.add(key);
        const client = manager.getProjectClient(projectPath, entry);
        if (!client) continue;
        const previous = scopes.get(key);
        if (previous && previous.projectPath !== projectPath) previous.controller.dispose();
        const controller = previous?.projectPath === projectPath ? previous.controller
          : createProjectTerminal({ scopeKey: key, cache: queryClient, getState: store.getState, foreground });
        controller.configure({
          identity, client, headers, online, directory: projectPath, serverContract: contract,
          serverUrl: entry.settings.serverUrl, rejectRedirects: Boolean(entry.settings.oidc),
          isCurrentClient(candidate) {
            const current = store.getState().registry.connections.find(({ id }) => id === entry.id);
            return current?.enabled === true && current.revision === entry.revision
              && current.settings === entry.settings && connections.get(entry.id) === manager
              && candidate === manager.getProjectClient(projectPath, current);
          },
        });
        if (changedForeground) controller.setForeground(foreground);
        const queryKey = projectQueryKey(identity, client, 'terminals');
        if (!previous || previous.controller !== controller || queryKey.some((piece, index) => previous.queryKey[index] !== piece)) {
          scopes.set(key, { key, target: { connectionId: entry.id, projectPath: path }, projectPath, queryKey, controller });
          changed = true;
        }
      }
    }
    for (const id of credentials.keys()) if (!enabled.has(id)) dropCredentials(id);
    for (const [key, scope] of scopes) {
      if (active.has(key)) continue;
      scope.controller.dispose();
      scopes.delete(key);
      changed = true;
    }
    if (changed) { views = [...scopes.values()]; notify(); }
  }

  function dispose() {
    stop?.();
    stop = undefined;
    for (const scope of scopes.values()) scope.controller.dispose();
    scopes.clear();
    for (const id of credentials.keys()) dropCredentials(id);
    views = [];
    notify();
  }

  return {
    start() {
      if (!stop) {
        const stopStore = store.subscribe((current, previous) => {
          if (current.registry.connections !== previous.registry.connections || current.selection !== previous.selection) reconcile();
        });
        const stopLifecycle = connections.subscribeState(reconcile);
        const stopEnvironment = connections.environment.subscribe(reconcile);
        stop = () => { stopStore(); stopLifecycle(); stopEnvironment(); };
        reconcile();
      }
      return dispose;
    },
    dispose,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get: (key: string) => scopes.get(key),
    all: () => views,
    resolve(target?: WorkspaceTarget) {
      if (target) return scopes.get(workspaceKey(target))
        ?? views.find((scope) => scope.target.connectionId === target.connectionId && scope.projectPath === target.projectPath);
    },
  };
}
