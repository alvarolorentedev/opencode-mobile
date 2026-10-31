import { withReadSignal, type ScopedOpencodeClient } from '@/lib/opencode/client';
import type { RawSkillInfo } from '@/lib/opencode/extensions/types';
import { createServerAdapter } from '@/lib/opencode/contracts/server-adapter';
import { toAgentOption } from '@/providers/opencode-model-selection';
import { discoverProviderCapabilities } from '@/providers/services/capabilities-service';
import { getFileStatus, getVcsInfo } from '@/providers/services/project-service';
import { combineProjectCatalog, listCommands, listServerProjects, readCatalogLocation } from '@/providers/services/session-service';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { connectionQueryKey, projectQueryKey, type QueryIdentity } from './keys';

export function capabilitiesOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'capabilities'),
    queryFn: ({ signal }) => discoverProviderCapabilities(withReadSignal(client, signal)) });
}
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
export function commandsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'commands'),
    queryFn: ({ signal }) => listCommands(withReadSignal(client, signal)) });
}
export function fileStatusOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'file-status'), staleTime: 0,
    queryFn: ({ signal }) => getFileStatus(withReadSignal(client, signal)) });
}
export function vcsInfoOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'vcs'), staleTime: 0,
    queryFn: ({ signal }) => getVcsInfo(withReadSignal(client, signal)) });
}

export function configurationOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'configuration'),
    queryFn: ({ signal }) => createServerAdapter(withReadSignal(client, signal)).capabilities.configuration() });
}
export function agentsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'agents'),
    queryFn: async ({ signal }) => (await createServerAdapter(withReadSignal(client, signal)).capabilities.agents() as Parameters<typeof toAgentOption>[0][]).map(toAgentOption) });
}
export function skillsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'skills'),
    queryFn: async ({ signal }) => {
      const details = await createServerAdapter(withReadSignal(client, signal)).capabilities.skillDetails();
      return { items: details.map(({ id, name, description }) => ({ id, name, description })), details: details as RawSkillInfo[] | undefined };
    } });
}
export function referencesOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'references'),
    queryFn: ({ signal }) => createServerAdapter(withReadSignal(client, signal)).capabilities.references() });
}
