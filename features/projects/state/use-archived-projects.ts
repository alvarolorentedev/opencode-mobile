import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { buildClient } from '@/shared/protocol/opencode/client';
import { resolveProjectLocation } from '@/shared/protocol/services/session-service';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { connectionQueryKey } from '@/shared/server-data/keys';
import { useWorkspaces } from '@/runtime/workspace';
import { archivedProjectsOptions } from '@/features/projects/services/queries/catalog';

export function useArchivedProjects(connectionId: string | undefined, enabled: boolean) {
  const registry = useWorkspaces();
  const cache = useQueryClient();
  const entry = useMemo(() => registry.connections.find((connection) => connection.id === connectionId), [connectionId, registry.connections]);
  const contract = useMemo(() => {
    for (const [key, snapshot] of Object.entries(registry.snapshots)) {
      const [id] = JSON.parse(key) as string[];
      if (id === connectionId) return snapshot.values.connectionValue.serverCapabilities.contract;
    }
    return 'v2' as const;
  }, [connectionId, registry.snapshots]);
  const identity = useMemo(() => entry ? {
    connectionId: entry.id,
    connectionScope: getConnectionScope(entry.settings),
    authRevision: entry.authRevision ?? 0,
  } : undefined, [entry]);
  const client = useMemo(() => entry ? buildClient({ ...entry.settings, directory: '' }, contract) : undefined,
    [contract, entry]);
  const supported = Boolean(entry?.enabled) && contract === 'v2';
  const query = useQuery({ ...(client ? archivedProjectsOptions(identity!, client) : { queryKey: ['archived-projects-disabled'], queryFn: async () => [] }), enabled: Boolean(client) && supported && enabled });

  const restore = useCallback(async (project: import('@/shared/protocol/opencode/types').Project) => {
    if (!entry || !identity) throw new Error('This server is no longer available.');
    const scoped = buildClient({ ...entry.settings, directory: project.worktree }, contract);
    const resolved = await resolveProjectLocation(scoped).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) throw new Error('OpenCode could not find that project folder. The server needs the folder before it can restore the project.');
      throw reason;
    });
    await cache.invalidateQueries({ queryKey: [...connectionQueryKey(identity, contract), 'server', 'projects'] });
    return resolved.directory || project.worktree;
  }, [cache, contract, entry, identity]);

  return {
    projects: query?.data ?? [],
    loading: Boolean(query?.isFetching),
    error: query?.error instanceof Error ? query.error.message : undefined,
    supported,
    restore,
  };
}
