import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { combineProjectCatalog, listServerProjects, readCatalogLocation } from '@/shared/protocol/services/session-service';

import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { connectionQueryKey, projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function projectsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: [...connectionQueryKey(identity, client.__opencode.contract), 'server', 'projects'],
    queryFn: ({ signal }) => listServerProjects(withReadSignal(client, signal)) });
}

export function locationOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'location'),
    queryFn: ({ signal }) => readCatalogLocation(withReadSignal(client, signal)) });
}

export async function fetchProjectCatalog(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, fresh = false) {
  const [projects, location] = await Promise.all([
    cache.fetchQuery({ ...projectsOptions(identity, client), ...(fresh ? { staleTime: 0 } : {}) }),
    cache.fetchQuery({ ...locationOptions(identity, client), ...(fresh ? { staleTime: 0 } : {}) }),
  ]);
  if (!client.__opencode.directory && location.currentProjectPath) {
    const root = { ...client, __opencode: { ...client.__opencode, directory: location.currentProjectPath } };
    const key = locationOptions(identity, root).queryKey;
    // The probe already resolved this directory; do not fetch it again on activation.
    if (cache.getQueryData(key) === undefined) cache.setQueryData(key, location, { updatedAt: cache.getQueryState(locationOptions(identity, client).queryKey)?.dataUpdatedAt });
  }
  return combineProjectCatalog(client, projects, location);
}
