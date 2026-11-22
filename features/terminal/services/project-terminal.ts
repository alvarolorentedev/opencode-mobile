import type { QueryClient } from '@tanstack/react-query';

import type { AppState } from '@/runtime/core';
import type { ScopedOpencodeClient, ServerContract } from '@/shared/protocol/opencode/client';
import type { Pty } from '@/shared/protocol/opencode/types';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
import { createTerminal as createPty, listTerminals, removeTerminal } from '@/features/terminal/services/terminal-service';
import { createTerminalConnection, type TerminalConnectionContext } from '@/features/terminal/services/terminal-connection';
import type { TerminalInstance, TerminalRenderer } from '@/features/terminal/model/terminal-types';

export const EMPTY_TERMINALS: Pty[] = [];
export const EMPTY_TERMINAL_INSTANCES: TerminalInstance[] = [];

type TerminalInput = {
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  headers?: Record<string, string>;
  rejectRedirects?: boolean;
  enabled?: boolean;
  online?: boolean;
};

export function createProjectTerminal({ scopeKey, cache, getState, foreground }: {
  scopeKey: string;
  cache: QueryClient;
  getState: () => AppState;
  foreground: boolean;
}) {
  let input: TerminalInput | undefined;
  let resetGeneration = 0;
  let refreshRequest = 0;
  const connections = new Map<string, ReturnType<typeof createTerminalConnection>>();
  const device = () => getState().terminal[scopeKey];
  const setDevice = (patch: Parameters<AppState['setTerminalState']>[1]) => getState().setTerminalState(scopeKey, patch);
  const isCurrent = (captured: TerminalInput) => input?.client === captured.client && input.enabled !== false && captured.isCurrentClient(captured.client);
  const isForeground = () => foreground && input?.enabled !== false && input?.online !== false;
  const key = ({ client, identity }: TerminalInput) => projectQueryKey(identity, client, 'terminals');

  function configure(next: TerminalInput) {
    const previous = input;
    const wasForeground = isForeground();
    input = next;
    if (isForeground() !== wasForeground) {
      for (const connection of connections.values()) connection.foreground(isForeground());
    } else if (previous && (previous.client !== next.client || previous.directory !== next.directory
      || previous.serverUrl !== next.serverUrl || previous.serverContract !== next.serverContract
      || previous.headers !== next.headers || previous.rejectRedirects !== next.rejectRedirects)) {
      for (const connection of connections.values()) connection.reconnect();
    }
  }

  function discardConnections() {
    for (const connection of connections.values()) connection.dispose();
    connections.clear();
    resetGeneration++;
    refreshRequest++;
    if (device()) setDevice((current) => ({ scope: current.scope + 1, activeTerminalId: undefined, instances: EMPTY_TERMINAL_INSTANCES }));
  }

  function resetTerminal() {
    discardConnections();
    if (input && cache.getQueryData(key(input)) !== undefined) cache.setQueryData(key(input), EMPTY_TERMINALS);
  }

  async function refreshTerminals() {
    const current = input;
    if (!current || !isCurrent(current)) return;
    const request = ++refreshRequest;
    const opened = new Set(connections.keys());
    const terminals = await listTerminals(current.client);
    if (!isCurrent(current) || request !== refreshRequest) return;
    cache.setQueryData(key(current), terminals);
    for (const [id, connection] of connections) {
      if (!opened.has(id) || connection.state.status === 'exited') continue;
      const pty = terminals.find((item) => item.id === id);
      if (!pty || pty.status === 'exited') connection.exit();
    }
  }

  function setForeground(active: boolean) {
    foreground = active;
    for (const connection of connections.values()) connection.foreground(isForeground());
    if (active && connections.size) void refreshTerminals().catch(() => undefined);
  }

  async function openTerminal(ptyId: string) {
    const openedWith = input;
    if (!openedWith || !isCurrent(openedWith)) return;
    const existing = connections.get(ptyId);
    if (existing) {
      if (existing.state.status === 'error' || existing.state.status === 'idle') existing.reconnect();
      setDevice({ activeTerminalId: ptyId });
      return;
    }
    const initial: TerminalInstance = { id: ptyId, generation: 0, status: 'connecting' };
    const connection = createTerminalConnection({
      id: ptyId,
      context: (): TerminalConnectionContext => {
        // A retained PTY reads fresh credentials on every upgrade. A disposed
        // transport gets an inactive context while its last callback unwinds.
        const current = input ?? openedWith;
        return { ...current, current: isCurrent(current) };
      },
      readState: () => device()?.instances.find(({ id }) => id === ptyId) ?? initial,
      publish: (next) => setDevice((current) => ({ instances: current.instances.map((instance) => instance.id === ptyId ? next : instance) })),
    });
    connections.set(ptyId, connection);
    setDevice((current) => ({ activeTerminalId: ptyId, instances: [...current.instances, initial] }));
    connection.foreground(isForeground());
  }

  async function createTerminal() {
    const current = input;
    if (!current || !isCurrent(current)) throw new Error('Connect this server before creating a terminal.');
    const generation = resetGeneration;
    const terminal = await createPty(current.client);
    if (generation !== resetGeneration || !isCurrent(current)) return terminal;
    await refreshTerminals();
    if (generation === resetGeneration && isCurrent(current)) await openTerminal(terminal.id);
    return terminal;
  }

  function sendTerminalInput(ptyId: string, text: string, generation: number, expectedScope: number) {
    if (expectedScope !== (device()?.scope ?? 0)) throw new Error('Terminal scope changed.');
    const connection = connections.get(ptyId);
    if (!connection) throw new Error('Terminal is not open.');
    connection.send(text, generation);
  }

  async function closeTerminal(ptyId: string) {
    const current = input;
    if (!current || !isCurrent(current)) throw new Error('Connect this server before terminating its terminal.');
    const generation = resetGeneration;
    const opened = connections.get(ptyId);
    await removeTerminal(current.client, ptyId);
    if (generation !== resetGeneration || !isCurrent(current) || connections.get(ptyId) !== opened) return;
    opened?.dispose();
    connections.delete(ptyId);
    setDevice((current) => ({
      activeTerminalId: current.activeTerminalId === ptyId ? connections.keys().next().value : current.activeTerminalId,
      instances: current.instances.filter(({ id }) => id !== ptyId),
    }));
    await refreshTerminals();
  }

  return {
    configure, setForeground, resetTerminal, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal,
    pause() { if (input) configure({ ...input, enabled: false }); },
    dispose() { discardConnections(); input = undefined; },
    registerRenderer: (ptyId: string, renderer: TerminalRenderer) => connections.get(ptyId)?.register(renderer) ?? (() => {}),
    resize(ptyId: string, cols: number, rows: number) { connections.get(ptyId)?.resize(cols, rows); },
  };
}
