import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { Pty } from '@/shared/protocol/opencode/types';

import type { TerminalContextValue } from './types';

type TerminalScope = {
  key: string;
  connectionId: string;
  projectPath: string;
  terminals: Pty[];
  actions: Pick<TerminalContextValue, 'openTerminal' | 'closeTerminal'>;
};

export function workspaceTerminals(connections: ConnectionRecord[], scopes: TerminalScope[]) {
  const rows = new Map<string, {
    key: string; connectionId: string; projectPath: string; serverName: string;
    terminal: Pty; actions: TerminalScope['actions'];
  }>();
  for (const { key, connectionId, projectPath, terminals, actions } of scopes) {
    const server = connections.find((entry) => entry.id === connectionId);
    if (!server?.enabled) continue;
    const serverName = connections.filter((entry) => entry.name === server.name).length > 1
      ? `${server.name} · ${new URL(server.settings.serverUrl).host}` : server.name;
    for (const terminal of terminals) {
      const identity = JSON.stringify([connectionId, terminal.id]);
      // Some servers return all PTYs for each directory; prefer their owning workspace.
      if (!rows.has(identity) || projectPath === terminal.cwd) rows.set(identity, { key, connectionId, projectPath, serverName, terminal, actions });
    }
  }
  return [...rows.values()];
}
