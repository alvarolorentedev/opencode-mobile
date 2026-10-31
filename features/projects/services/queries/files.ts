import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectPath } from '@/shared/protocol/opencode/project';
import { findFiles, listFiles, listWorktrees } from '@/features/projects/services/project-service';
import { queryOptions } from '@tanstack/react-query';
import { locationOptions } from '@/features/projects/services/queries/catalog';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function directoryOptions(identity: QueryIdentity, client: ScopedOpencodeClient, path: string) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'directory', path), staleTime: 0,
    queryFn: ({ signal }) => listFiles(withReadSignal(client, signal), path) });
}
export function searchOptions(identity: QueryIdentity, client: ScopedOpencodeClient, query: string) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'search', query), staleTime: 0,
    queryFn: async ({ signal }) => (await findFiles(withReadSignal(client, signal), query)).map((path) => projectPath(path, client.__opencode.directory || '')) });
}
export function worktreeOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'worktrees'),
    queryFn: async ({ signal, client: cache }) => {
      const location = await cache.fetchQuery(locationOptions(identity, client));
      if (signal.aborted) throw new Error('OpenCode read canceled.');
      const entries = await listWorktrees(withReadSignal(client, signal), location.project.id);
      return { project: location.project, entries };
    } });
}
