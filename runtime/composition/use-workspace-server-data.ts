import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { CachedCapabilities } from '@/features/ai/index';
import { hydrateCapabilitiesSnapshot, persistCapabilitiesSnapshot , getConfiguredProviderIds , agentsOptions , capabilitiesOptions } from '@/features/ai/runtime';
import { commandsOptions, configurationOptions, referencesOptions, skillsOptions } from '@/shared/server-data/catalogs';
import { fileStatusOptions, vcsInfoOptions , locationOptions, projectsOptions } from '@/features/projects/runtime';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { combineProjectCatalog } from '@/shared/protocol/services/session-service';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

const EMPTY: never[] = [];
const EMPTY_METHODS = {};
export function useWorkspaceServerData(client: ScopedOpencodeClient, active: boolean, isCurrent: (client: object) => boolean) {
  const identity = useQueryIdentity();
  const demanded = useQueryActivity();
  active = active && demanded;
  const cache = useQueryClient();
  const capOptions = capabilitiesOptions(identity, client);
  const enabled = active && Boolean(client.__opencode.directory);
  const [discovery] = useQueries({ queries: [{ ...capOptions, enabled }].filter(() => demanded) });
  const [configuration] = useQueries({ queries: [{ ...configurationOptions(identity, client), enabled }].filter(() => demanded) });
  const [agents] = useQueries({ queries: [{ ...agentsOptions(identity, client), enabled }].filter(() => demanded) });
  const [skills] = useQueries({ queries: [{ ...skillsOptions(identity, client), enabled }].filter(() => demanded) });
  const [references] = useQueries({ queries: [{ ...referencesOptions(identity, client), enabled }].filter(() => demanded) });
  const [projects] = useQueries({ queries: [{ ...projectsOptions(identity, client), enabled: active }].filter(() => demanded) });
  const [location] = useQueries({ queries: [{ ...locationOptions(identity, client), enabled: active }].filter(() => demanded) });
  const [commands] = useQueries({ queries: [{ ...commandsOptions(identity, client), enabled }].filter(() => demanded) });
  const [statuses] = useQueries({ queries: [{ ...fileStatusOptions(identity, client), enabled }].filter(() => demanded) });
  const [vcs] = useQueries({ queries: [{ ...vcsInfoOptions(identity, client), enabled }].filter(() => demanded) });
  const capabilities = useMemo<CachedCapabilities | undefined>(() => {
    if (!discovery?.data || !configuration?.data || !agents?.data) return undefined;
    const ids = getConfiguredProviderIds(configuration?.data?.config, discovery?.data.connected, discovery?.data.models);
    return { ...discovery?.data, config: configuration?.data?.config,
      providers: discovery?.data.providers.map((provider) => ({ ...provider, configured: provider.configured || ids.has(provider.id) })),
      agents: agents?.data ?? EMPTY, skills: skills?.data?.items ?? EMPTY, references: references?.data ?? EMPTY };
  }, [discovery?.data, configuration?.data, agents?.data, skills?.data, references?.data]);
  const catalog = useMemo(() => projects?.data && location?.data ? combineProjectCatalog(client, projects?.data, location?.data) : undefined, [client, projects?.data, location?.data]);
  useEffect(() => {
    const path = client.__opencode.directory;
    if (!path || !demanded || identity.authRevision > 0) return;
    const key = capabilitiesOptions(identity, client).queryKey;
    void hydrateCapabilitiesSnapshot(identity.connectionScope, path, (value, cachedAt) => {
      if (!cache.getQueryData(key)) cache.setQueryData(key, { providers: value.providers, models: value.models, connected: value.connected, providerAuthMethodsById: value.providerAuthMethodsById }, { updatedAt: cachedAt });
      const configKey = configurationOptions(identity, client).queryKey;
      if (value.config && !cache.getQueryData(configKey)) cache.setQueryData(configKey, { config: value.config }, { updatedAt: cachedAt });
      const skillsKey = skillsOptions(identity, client).queryKey;
      if (value.skills && !cache.getQueryData(skillsKey)) cache.setQueryData(skillsKey, { items: value.skills.map((skill) => ({ ...skill, description: skill.description })), details: undefined }, { updatedAt: cachedAt });
      const refsKey = referencesOptions(identity, client).queryKey;
      if (value.references && !cache.getQueryData(refsKey)) cache.setQueryData(refsKey, value.references, { updatedAt: cachedAt });
      const agentsKey = agentsOptions(identity, client).queryKey;
      if (!cache.getQueryData(agentsKey)) cache.setQueryData(agentsKey, value.agents, { updatedAt: cachedAt });
    }, () => isCurrent(client));
  }, [cache, client, demanded, identity, isCurrent]);
  useEffect(() => {
    const path = client.__opencode.directory;
    if (path && capabilities?.models.length && discovery?.dataUpdatedAt) {
      void persistCapabilitiesSnapshot(identity.connectionScope, path, capabilities, Math.min(discovery?.dataUpdatedAt, configuration?.dataUpdatedAt ?? 0, agents?.dataUpdatedAt ?? 0));
    }
  }, [capabilities, discovery?.dataUpdatedAt, configuration?.dataUpdatedAt, agents?.dataUpdatedAt, client, identity.connectionScope]);
  const refreshChatCapabilities = useCallback(async () => {
    if (!isCurrent(client) || !client.__opencode.directory) return;
    await cache.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'opencode' && query.queryKey[1] === identity.connectionId
      && ['capabilities', 'configuration', 'agents', 'skills', 'references', 'extension-inspection'].includes(String(query.queryKey[7])), refetchType: demanded ? 'active' : 'none' });
  }, [cache, client, demanded, identity, isCurrent]);
  const refreshServerFeatures = useCallback(async () => {
    if (!isCurrent(client) || !client.__opencode.directory) return;
    if (!demanded) { await cache.invalidateQueries({ queryKey: capabilitiesOptions(identity, client).queryKey.slice(0, -1), refetchType: 'none' }); return; }
    await Promise.all([
      cache.fetchQuery({ ...commandsOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery(fileStatusOptions(identity, client)),
      cache.fetchQuery(vcsInfoOptions(identity, client)),
    ]);
  }, [cache, client, demanded, identity, isCurrent]);
  return {
    capabilities, refreshChatCapabilities, refreshServerFeatures,
    currentConfig: capabilities?.config, availableProviders: capabilities?.providers ?? EMPTY,
    providerAuthMethodsById: capabilities?.providerAuthMethodsById ?? EMPTY_METHODS,
    availableModels: capabilities?.models ?? EMPTY, availableAgents: capabilities?.agents ?? EMPTY,
    availableSkills: capabilities?.skills ?? EMPTY, availableReferences: capabilities?.references ?? EMPTY,
    serverProjects: catalog?.serverProjects ?? EMPTY,
    currentProjectPath: catalog?.currentProjectPath, serverRootPath: catalog?.serverRootPath,
    isRefreshingProjectCatalog: Boolean(projects?.isFetching || location?.isFetching), commands: commands?.data ?? EMPTY,
    projectFileStatuses: statuses?.data ?? EMPTY, vcsInfo: vcs?.data,
  };
}
