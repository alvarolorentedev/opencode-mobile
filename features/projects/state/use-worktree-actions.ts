import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { useProjectScope } from '@/runtime/core';
import type { Project } from '@/shared/protocol/opencode/types';

import { createWorktreeCommands } from '../services/worktree-commands';

export function useWorktreeActions({ client, identity, isCurrentClient, queryActive }: ReturnType<typeof useProjectScope>, serverProjects: Project[]) {
  const cache = useQueryClient();
  const commands = useMemo(() => createWorktreeCommands({ cache, identity, client, isCurrent: () => isCurrentClient(client), shouldRefresh: () => queryActive }),
    [cache, client, identity, isCurrentClient, queryActive]);
  const removeWorktree = useCallback((directory: string) => commands.removeWorktree(directory, serverProjects), [commands, serverProjects]);
  return { refreshWorktrees: commands.refreshWorktrees, removeWorktree };
}
