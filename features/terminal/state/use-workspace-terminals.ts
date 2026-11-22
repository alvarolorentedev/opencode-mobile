import { queryOptions, skipToken, useQueries } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { Pty } from '@/shared/protocol/opencode/types';

import { workspaceTerminals } from '@/features/terminal/model/workspace-terminals';

const emptyScopes: [] = [];
const emptyTerminals: Pty[] = [];

export function useWorkspaceTerminals() {
  const { terminal, commands: { workspace } } = useAppCore();
  const connections = useAppStore((state) => state.registry.connections);
  const scopes = useSyncExternalStore(terminal.subscribe, terminal.all, () => emptyScopes);
  const lists = useQueries({ queries: scopes.map(({ queryKey }) => queryOptions<Pty[]>({ queryKey, queryFn: skipToken })) });
  const terminals = workspaceTerminals(connections, scopes.map(({ key, target, projectPath, controller }, index) => ({
    key, connectionId: target.connectionId, projectPath, terminals: lists[index].data ?? emptyTerminals, actions: controller,
  })));
  const create = useCallback(async (target: WorkspaceTarget) => {
    await workspace.connectedWorkspace(target);
    const scope = terminal.resolve(target);
    if (!scope) throw new Error('Connect this server before creating a terminal.');
    const created = await scope.controller.createTerminal();
    await workspace.selectTerminalTarget(target);
    return created;
  }, [terminal, workspace]);
  return { create, terminals };
}
