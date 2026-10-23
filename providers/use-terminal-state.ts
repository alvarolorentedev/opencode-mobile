import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import type { Pty, PtyShellsResponse } from '@/lib/opencode/types';
import { createTerminal as svcCreateTerminal, listShells, listTerminals, removeTerminal } from '@/providers/services/terminal-service';
import { createTerminalConnection, type TerminalConnectionContext } from './terminal-connection';
import type { TerminalInstance, TerminalRenderer, TerminalRuntime } from './terminal-types';

export function useTerminalState({ client, isCurrentClient, serverUrl, directory, serverContract, headers, enabled = true, online = true }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  headers?: Record<string, string>;
  enabled?: boolean;
  online?: boolean;
}) {
  const [terminals, setTerminals] = useState<Pty[]>([]);
  const [terminalShells, setTerminalShells] = useState<PtyShellsResponse>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [instances, setInstances] = useState<TerminalInstance[]>([]);
  const [scope, setScope] = useState(0);
  const scopeRef = useRef(0);
  const refreshRequest = useRef(0);
  const connections = useRef(new Map<string, ReturnType<typeof createTerminalConnection>>());
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => { enabledRef.current = enabled; }, [enabled]);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const publish = useCallback(() => setInstances([...connections.current.values()].map((entry) => entry.state)), []);

  // Retained PTY transports read the live client/credentials through this
  // accessor so a same-machine credential rotation reconnects instead of
  // tearing down the renderer and its cursor.
  const latest = useRef({ client, isCurrentClient, serverUrl, directory, serverContract, headers });
  useLayoutEffect(() => {
    latest.current = { client, isCurrentClient, serverUrl, directory, serverContract, headers };
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
    };
  }, []);

  useEffect(() => {
    const owned = connections.current;
    return () => { for (const connection of owned.values()) connection.dispose(); owned.clear(); };
  }, []);

  useEffect(() => {
    for (const connection of connections.current.values()) connection.foreground(enabled && online && foreground.current);
  }, [enabled, online]);

  const resetTerminal = useCallback(() => {
    for (const connection of connections.current.values()) connection.dispose();
    connections.current.clear();
    setTerminals([]); setTerminalShells([]); setActiveTerminalId(undefined); setInstances([]);
    refreshRequest.current++;
    scopeRef.current++;
    setScope(scopeRef.current);
  }, []);

  const refreshTerminals = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    const request = ++refreshRequest.current;
    const opened = new Set(connections.current.keys());
    const [nextTerminals, nextShells] = await Promise.all([listTerminals(client), listShells(client)]);
    if (!isCurrentClient(client) || request !== refreshRequest.current) return;
    setTerminals(nextTerminals); setTerminalShells(nextShells);
    for (const [id, connection] of connections.current) {
      const pty = nextTerminals.find((item) => item.id === id);
      if (opened.has(id) && (!pty || pty.status === 'exited') && connection.state.status !== 'exited') connection.exit();
    }
  }, [client, isCurrentClient]);

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
      const connection = createTerminalConnection({ id: ptyId, context, publish });
      connections.current.set(ptyId, connection);
      connection.foreground(enabledRef.current && online && foreground.current);
      publish();
    } else if (existing.state.status === 'error' || existing.state.status === 'idle') existing.reconnect();
    setActiveTerminalId(ptyId);
  }, [context, online, publish]);

  // A new client (credential rotation) reuses the same transport with fresh
  // credentials; project switches dispose connections before this runs.
  useEffect(() => {
    for (const connection of connections.current.values()) connection.reconnect();
  }, [headers, client, directory, serverContract, serverUrl]);

  const createTerminal = useCallback(async (command?: string, title?: string) => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before creating a terminal.');
    const terminal = await svcCreateTerminal(client, { command: command?.trim() || undefined, title: title?.trim() || undefined, cwd: directory });
    if (!isCurrentClient(client)) return terminal;
    await refreshTerminals();
    if (isCurrentClient(client)) await openTerminal(terminal.id);
    return terminal;
  }, [client, directory, isCurrentClient, openTerminal, refreshTerminals]);

  const sendTerminalInput = useCallback((ptyId: string, input: string, generation: number, expectedScope: number) => {
    if (expectedScope !== scopeRef.current) throw new Error('Terminal scope changed.');
    const connection = connections.current.get(ptyId);
    if (!connection) throw new Error('Terminal is not open.');
    connection.send(input, generation);
  }, []);

  const closeTerminal = useCallback(async (ptyId: string) => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before terminating its terminal.');
    await removeTerminal(client, ptyId);
    if (!isCurrentClient(client)) return;
    connections.current.get(ptyId)?.dispose(); connections.current.delete(ptyId);
    setActiveTerminalId((current) => current === ptyId ? connections.current.keys().next().value : current);
    publish();
    await refreshTerminals();
  }, [client, isCurrentClient, publish, refreshTerminals]);

  const registerRenderer = useCallback((ptyId: string, renderer: TerminalRenderer) => {
    return connections.current.get(ptyId)?.register(renderer) ?? (() => {});
  }, []);
  const resize = useCallback((ptyId: string, cols: number, rows: number) => {
    connections.current.get(ptyId)?.resize(cols, rows);
  }, []);
  const terminalRuntime = useMemo<TerminalRuntime>(() => ({ scope, instances, registerRenderer, resize }), [scope, instances, registerRenderer, resize]);
  const terminalConnection = instances.find((entry) => entry.id === activeTerminalId)?.status ?? 'idle';

  return { terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, openTerminal, createTerminal, sendTerminalInput, closeTerminal, resetTerminal };
}
