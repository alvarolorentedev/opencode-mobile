import type { QueryIdentity } from '@/shared/server-data/keys';
import { useCallback, useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { ProjectWorktree } from '@/shared/protocol/opencode/project';
import type { Project } from '@/shared/protocol/opencode/types';
import { getProjectLabel } from '@/features/projects/model/project-utils';
import { worktreeOptions } from '@/features/projects/services/queries/files';
import { createWorktreeCommands } from '@/features/projects/services/worktree-commands';
import { useQueries, useQueryClient } from '@tanstack/react-query';

export type WorktreeCatalog = { entries: ProjectWorktree[]; project?: { id: string; root: string; label: string }; loading: boolean; error?: string };

export function useWorktreeState({ client, identity, isCurrentClient, serverProjects, connected, queryActive: active }: {
  identity: QueryIdentity;
  queryActive: boolean;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverProjects: Project[];
  connected: boolean;
}) {
  const cache = useQueryClient();
  const options = worktreeOptions(identity, client);
  const [query] = useQueries({ queries: [{ ...options, enabled: connected && active && Boolean(client.__opencode.directory), subscribed: active }].filter(() => active) });
  const worktrees = useMemo<WorktreeCatalog>(() => ({
    entries: (query?.data?.entries ?? []).filter((entry) => !serverProjects.some((known) => known.worktree === entry.directory)),
    project: query?.data ? { id: query?.data.project.id, root: query?.data.project.worktree, label: getProjectLabel(query?.data.project.worktree) } : undefined,
    loading: Boolean(query?.isFetching), error: query?.error?.message,
  }), [query?.data, query?.isFetching, query?.error, serverProjects]);
  const commands = useMemo(() => createWorktreeCommands({ cache, identity, client, isCurrent: () => isCurrentClient(client), shouldRefresh: () => active }),
    [active, cache, client, identity, isCurrentClient]);
  const removeWorktree = useCallback((directory: string) => commands.removeWorktree(directory, serverProjects), [commands, serverProjects]);

  return { worktrees, refreshWorktrees: commands.refreshWorktrees, removeWorktree };
}
