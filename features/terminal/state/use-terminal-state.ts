import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { useAppCore, useAppStore, type AppState as CoreState } from '@/runtime/core';
import type { ScopedOpencodeClient, ServerContract } from '@/shared/protocol/opencode/client';
import type { Pty } from '@/shared/protocol/opencode/types';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
import { createTerminal as svcCreateTerminal, listTerminals, removeTerminal } from '@/features/terminal/services/terminal-service';
import { createTerminalConnection, type TerminalConnectionContext } from '@/features/terminal/services/terminal-connection';
import type { TerminalInstance, TerminalRenderer, TerminalRuntime } from '@/features/terminal/model/terminal-types';

const EMPTY_TERMINALS: Pty[] = [];
const EMPTY_INSTANCES: TerminalInstance[] = [];

export function useTerminalState({ scopeKey, identity, client, isCurrentClient, serverUrl, directory, serverContract, headers, rejectRedirects, enabled = true, online = true }: {
  identity: QueryIdentity;
  scopeKey: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  headers?: Record<string, string>;
  rejectRedirects?: boolean;
  enabled?: boolean;
  online?: boolean;
}) {
  const { store } = useAppCore();
  const device = useAppStore((state) => state.terminal[scopeKey]);
  const { scope = 0, activeTerminalId, instances = EMPTY_INSTANCES } = device ?? {};
  const cache = useQueryClient();
  const key = useMemo(() => projectQueryKey(identity, client, 'terminals'), [client, identity]);
  const { data: terminals = EMPTY_TERMINALS } = useQuery<Pty[]>({ queryKey: key, queryFn: skipToken });
  const setDevice = useCallback((patch: Parameters<CoreState['setTerminalState']>[1]) => {
    store.getState().setTerminalState(scopeKey, patch);
  }, [scopeKey, store]);
  const refreshRequest = useRef(0);
  const connections = useRef(new Map<string, ReturnType<typeof createTerminalConnection>>());
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => { enabledRef.current = enabled; }, [enabled]);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');

  // Retained PTY transports read the live client/credentials through this
  // accessor so a same-machine credential rotation reconnects instead of
  // tearing down the renderer and its cursor.
  const latest = useRef({ client, isCurrentClient, serverUrl, directory, serverContract, headers, rejectRedirects });
  useLayoutEffect(() => {
    latest.current = { client, isCurrentClient, serverUrl, directory, serverContract, headers, rejectRedirects };
  });
  const context = useCallback((): TerminalConnectionContext => {
    const current = latest.current;
    return {
      client: current.client,
      current: current.isCurrentClient(current.client),
      serverUrl: current.serverUrl,
      directory: current.directory,
      serverContract: current.serverContract,
      headers: current.headers,
      rejectRedirects: current.rejectRedirects,
    };
  }, []);

  const disposeTerminals = useCallback(() => {
    for (const connection of connections.current.values()) connection.dispose();
    connections.current.clear();
    refreshRequest.current++;
    if (store.getState().terminal[scopeKey]) {
      setDevice((current) => ({ scope: current.scope + 1, activeTerminalId: undefined, instances: EMPTY_INSTANCES }));
    }
  }, [scopeKey, setDevice, store]);
  useEffect(() => disposeTerminals, [disposeTerminals]);

  useEffect(() => {
    for (const connection of connections.current.values()) connection.foreground(enabled && online && foreground.current);
  }, [enabled, online]);

  const resetTerminal = useCallback(() => {
    disposeTerminals();
    if (cache.getQueryData(key) !== undefined) cache.setQueryData(key, EMPTY_TERMINALS);
  }, [cache, disposeTerminals, key]);

  const refreshTerminals = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    const request = ++refreshRequest.current;
    const opened = new Set(connections.current.keys());
    const nextTerminals = await listTerminals(client);
    if (!isCurrentClient(client) || latest.current.client !== client || request !== refreshRequest.current) return;
    cache.setQueryData(key, nextTerminals);
    for (const [id, connection] of connections.current) {
      const pty = nextTerminals.find((item) => item.id === id);
      if (opened.has(id) && (!pty || pty.status === 'exited') && connection.state.status !== 'exited') connection.exit();
    }
  }, [cache, client, isCurrentClient, key]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      for (const connection of connections.current.values()) connection.foreground(enabledRef.current && online && foreground.current);
      if (foreground.current && connections.current.size) void refreshTerminals().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [online, refreshTerminals]);

  const openTerminal = useCallback(async (ptyId: string) => {
    const live = latest.current;
    if (!live.isCurrentClient(live.client)) return;
    const existing = connections.current.get(ptyId);
    if (!existing) {
      const initial: TerminalInstance = { id: ptyId, generation: 0, status: 'connecting' };
      const connection = createTerminalConnection({
        id: ptyId,
        context,
        readState: () => store.getState().terminal[scopeKey]?.instances.find(({ id }) => id === ptyId) ?? initial,
        publish: (next) => setDevice((current) => ({ instances: current.instances.map((instance) => instance.id === ptyId ? next : instance) })),
      });
      connections.current.set(ptyId, connection);
      setDevice((current) => ({ activeTerminalId: ptyId, instances: [...current.instances, initial] }));
      connection.foreground(enabledRef.current && online && foreground.current);
      return;
    }
    if (existing.state.status === 'error' || existing.state.status === 'idle') existing.reconnect();
    setDevice({ activeTerminalId: ptyId });
  }, [context, online, scopeKey, setDevice, store]);

  // A new client (credential rotation) reuses the same transport with fresh
  // credentials; project switches dispose connections before this runs.
  useEffect(() => {
    for (const connection of connections.current.values()) connection.reconnect();
  }, [headers, rejectRedirects, client, directory, serverContract, serverUrl]);

  const createTerminal = useCallback(async () => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before creating a terminal.');
    const terminal = await svcCreateTerminal(client);
    if (!isCurrentClient(client)) return terminal;
    await refreshTerminals();
    if (isCurrentClient(client)) await openTerminal(terminal.id);
    return terminal;
  }, [client, isCurrentClient, openTerminal, refreshTerminals]);

  const sendTerminalInput = useCallback((ptyId: string, input: string, generation: number, expectedScope: number) => {
    if (expectedScope !== (store.getState().terminal[scopeKey]?.scope ?? 0)) throw new Error('Terminal scope changed.');
    const connection = connections.current.get(ptyId);
    if (!connection) throw new Error('Terminal is not open.');
    connection.send(input, generation);
  }, [scopeKey, store]);

  const closeTerminal = useCallback(async (ptyId: string) => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before terminating its terminal.');
    await removeTerminal(client, ptyId);
    if (!isCurrentClient(client)) return;
    connections.current.get(ptyId)?.dispose(); connections.current.delete(ptyId);
    setDevice((current) => ({
      activeTerminalId: current.activeTerminalId === ptyId ? connections.current.keys().next().value : current.activeTerminalId,
      instances: current.instances.filter(({ id }) => id !== ptyId),
    }));
    await refreshTerminals();
  }, [client, isCurrentClient, refreshTerminals, setDevice]);

  const registerRenderer = useCallback((ptyId: string, renderer: TerminalRenderer) => {
    return connections.current.get(ptyId)?.register(renderer) ?? (() => {});
  }, []);
  const resize = useCallback((ptyId: string, cols: number, rows: number) => {
    connections.current.get(ptyId)?.resize(cols, rows);
  }, []);
  const terminalRuntime = useMemo<TerminalRuntime>(() => ({ scope, instances, registerRenderer, resize }), [scope, instances, registerRenderer, resize]);
  const terminalConnection = instances.find((entry) => entry.id === activeTerminalId)?.status ?? 'idle';

  return { terminals, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, openTerminal, createTerminal, sendTerminalInput, closeTerminal, resetTerminal };
}
