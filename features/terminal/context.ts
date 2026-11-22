import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { useActiveWorkspaceTarget, useAppCore, useAppStore } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { Pty } from '@/shared/protocol/opencode/types';

import type { TerminalContextValue } from './model/types';
import { EMPTY_TERMINALS, EMPTY_TERMINAL_INSTANCES } from './services/project-terminal';

const noop = () => {};
const emptyScopes: [] = [];
const idleActions = {
  registerRenderer: () => noop,
  resize: noop,
  refreshTerminals: async () => {},
  createTerminal: async () => { throw new Error('Connect this server before creating a terminal.'); },
  openTerminal: async () => {},
  sendTerminalInput: () => { throw new Error('Terminal is not open.'); },
  closeTerminal: async () => { throw new Error('Connect this server before terminating its terminal.'); },
};

export function useTerminal(explicit?: WorkspaceTarget): TerminalContextValue {
  const target = useActiveWorkspaceTarget(explicit);
  const { terminal } = useAppCore();
  const binding = useSyncExternalStore(terminal.subscribe, () => terminal.resolve(target), () => undefined);
  const opened = useAppStore((state) => binding ? state.terminal[binding.key] : undefined);
  const { data: terminals = EMPTY_TERMINALS } = useQuery<Pty[]>({
    queryKey: binding?.queryKey ?? ['disabled', 'terminals'],
    queryFn: skipToken,
  });
  const { scope = 0, activeTerminalId, instances = EMPTY_TERMINAL_INSTANCES } = opened ?? {};
  const { registerRenderer, resize, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal } = binding?.controller ?? idleActions;
  const terminalRuntime = useMemo(() => ({ scope, instances, registerRenderer, resize }), [scope, instances, registerRenderer, resize]);
  const terminalConnection = instances.find(({ id }) => id === activeTerminalId)?.status ?? 'idle';
  return { terminals, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal };
}

export function useRetainedTerminalScopes(target: WorkspaceTarget) {
  const { terminal } = useAppCore();
  const scopes = useSyncExternalStore(terminal.subscribe, terminal.all, () => emptyScopes);
  const opened = useAppStore((state) => state.terminal);
  return { scopes: scopes.filter(({ key }) => opened[key]?.instances.length), selectedKey: terminal.resolve(target)?.key };
}
