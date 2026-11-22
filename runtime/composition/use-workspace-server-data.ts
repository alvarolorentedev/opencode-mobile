import type { QueryIdentity } from '@/shared/server-data/keys';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { hydrateCapabilitiesSnapshot, persistCapabilitiesSnapshot, useCapabilitiesCatalog, agentsOptions, capabilitiesOptions } from '@/features/ai/runtime';
import { commandsOptions, configurationOptions, referencesOptions, skillsOptions } from '@/shared/server-data/catalogs';
import { fileStatusOptions, vcsInfoOptions } from '@/features/projects/runtime';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const EMPTY: never[] = [];
export function useWorkspaceServerData(identity: QueryIdentity, client: ScopedOpencodeClient, active: boolean, isCurrent: (client: object) => boolean, demanded: boolean) {
  active = active && demanded;
  const cache = useQueryClient();
  const enabled = active && Boolean(client.__opencode.directory);
  const data = useCapabilitiesCatalog(identity, client, demanded, enabled);
  const { capabilities, cachedAt } = data;
  const [commands] = useQueries({ queries: [{ ...commandsOptions(identity, client), enabled }].filter(() => demanded) });
  useQueries({ queries: [{ ...fileStatusOptions(identity, client), enabled }, { ...vcsInfoOptions(identity, client), enabled }].filter(() => demanded) });
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
    if (path && capabilities?.models.length && cachedAt) {
      void persistCapabilitiesSnapshot(identity.connectionScope, path, capabilities, cachedAt);
    }
  }, [cachedAt, capabilities, client, identity.connectionScope]);
  return { ...data, commands: commands?.data ?? EMPTY };
}
