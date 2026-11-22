import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { configurationOptions, referencesOptions, skillsOptions } from '@/shared/server-data/catalogs';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { getConfiguredProviderIds } from '../model/opencode-model-selection';
import type { CachedCapabilities } from '../services/capabilities-snapshot';
import { agentsOptions } from '../services/queries/agents';
import { capabilitiesOptions } from '../services/queries/capabilities';

const EMPTY: never[] = [];
const EMPTY_METHODS = {};

export function useCapabilitiesCatalog(identity: QueryIdentity, client: ScopedOpencodeClient, observed: boolean, enabled: boolean) {
  const [discovery] = useQueries({ queries: [{ ...capabilitiesOptions(identity, client), enabled }].filter(() => observed) });
  const [configuration] = useQueries({ queries: [{ ...configurationOptions(identity, client), enabled }].filter(() => observed) });
  const [agents] = useQueries({ queries: [{ ...agentsOptions(identity, client), enabled }].filter(() => observed) });
  const [skills] = useQueries({ queries: [{ ...skillsOptions(identity, client), enabled }].filter(() => observed) });
  const [references] = useQueries({ queries: [{ ...referencesOptions(identity, client), enabled }].filter(() => observed) });
  const discovered = discovery?.data;
  const configData = configuration?.data;
  const agentData = agents?.data;
  const skillData = skills?.data;
  const referenceData = references?.data;
  const capabilities = useMemo<CachedCapabilities | undefined>(() => {
    if (!discovered || !configData || !agentData) return undefined;
    const { config } = configData;
    const { models, connected, providers } = discovered;
    const ids = getConfiguredProviderIds(config, connected, models);
    return { ...discovered, config, providers: providers.map((provider) => ({ ...provider, configured: provider.configured || ids.has(provider.id) })),
      agents: agentData, skills: skillData?.items ?? EMPTY, references: referenceData ?? EMPTY };
  }, [agentData, configData, discovered, referenceData, skillData]);
  const cachedAt = Math.min(discovery?.dataUpdatedAt ?? 0, configuration?.dataUpdatedAt ?? 0, agents?.dataUpdatedAt ?? 0);
  return {
    capabilities, cachedAt,
    currentConfig: capabilities?.config, availableProviders: capabilities?.providers ?? EMPTY,
    providerAuthMethodsById: capabilities?.providerAuthMethodsById ?? EMPTY_METHODS,
    availableModels: capabilities?.models ?? EMPTY, availableAgents: capabilities?.agents ?? EMPTY,
    availableSkills: capabilities?.skills ?? EMPTY, availableReferences: capabilities?.references ?? EMPTY,
  };
}
