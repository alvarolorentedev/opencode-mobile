import type { QueryIdentity } from '@/shared/server-data/keys';
import { useCallback, useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Project } from '@/shared/protocol/opencode/types';
import { describeWorktrees } from '@/features/projects/model/project-utils';
import { worktreeOptions } from '@/features/projects/services/queries/files';
import { createWorktreeCommands } from '@/features/projects/services/worktree-commands';
import { useQueries, useQueryClient } from '@tanstack/react-query';

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
  const worktrees = useMemo(() => describeWorktrees(query?.data, serverProjects, query?.isFetching, query?.error?.message),
    [query?.data, query?.isFetching, query?.error, serverProjects]);
  const commands = useMemo(() => createWorktreeCommands({ cache, identity, client, isCurrent: () => isCurrentClient(client), shouldRefresh: () => active }),
    [active, cache, client, identity, isCurrentClient]);
  const removeWorktree = useCallback((directory: string) => commands.removeWorktree(directory, serverProjects), [commands, serverProjects]);

  return { worktrees, refreshWorktrees: commands.refreshWorktrees, removeWorktree };
}
