import type { Config } from '@/shared/protocol/opencode/types';

import { getPrimaryAgents, type ModelOption, type AgentOption } from '@/shared/contracts/model-options';

export function getSelectedModelVariant(
  sessionModel: { providerID: string; id: string; variant?: string } | undefined,
  models: ModelOption[],
) {
  if (!sessionModel) return undefined;
  const model = findModelOption(models, sessionModel);
  if (!model) return undefined;
  return model.variants.some((variant) => variant.id === sessionModel.variant)
    ? sessionModel.variant
    : undefined;
}

function findModelOption(models: ModelOption[], modelRef: { providerID: string; id: string }) {
  return models.find((model) => model.providerID === modelRef.providerID
    && (model.modelID === modelRef.id || model.id === modelRef.id));
}

export function getInitialMode(agents: AgentOption[], config?: Config, storedMode?: string) {
  const eligible = getPrimaryAgents(agents);
  return eligible.find((agent) => agent.id === storedMode)?.id
    ?? eligible.find((agent) => agent.id === config?.default_agent)?.id
    ?? eligible.find((agent) => agent.id === 'build')?.id
    ?? eligible[0]?.id;
}

export function resolveConfigModelId(models: ModelOption[], configModel?: string) {
  const normalized = configModel?.trim();
  if (!normalized) {
    return undefined;
  }

  const exact = models.find((model) => model.id === normalized);
  if (exact) {
    return exact.id;
  }

  // Server values may carry variant segments (e.g. `openrouter/~group/model`)
  // while the catalog lists the bare model, or vice versa. Match on the
  // provider plus the trailing model segment before giving up.
  const [configProvider, ...configRest] = normalized.split('/');
  const configLeaf = configRest.at(-1)?.trim();
  if (configProvider && configLeaf) {
    const leafMatch = models.find(
      (model) => model.providerID === configProvider && model.modelID.split('/').at(-1) === configLeaf,
    );
    if (leafMatch) {
      return leafMatch.id;
    }
    const modelPartMatch = models.find((model) => model.providerID === configProvider && model.modelID === configRest.join('/'));
    if (modelPartMatch) {
      return modelPartMatch.id;
    }
  }

  return undefined;
}

export function getEffectiveSessionModel(
  models: ModelOption[],
  config: Config | undefined,
  agents: AgentOption[],
  session?: { agent?: string; model?: { providerID: string; id: string; variant?: string } },
  fallbackAgentId?: string,
) {
  if (session?.model) {
    const model = findModelOption(models, session.model);
    return model
      ? { providerID: model.providerID, id: model.modelID, ...(session.model.variant ? { variant: session.model.variant } : {}) }
      : session.model;
  }
  const agentModel = agents.find((agent) => agent.id === (fallbackAgentId ?? session?.agent))?.model;
  if (agentModel) return { providerID: agentModel.providerID, id: agentModel.modelID, variant: agentModel.variant };
  const modelId = resolveConfigModelId(models, config?.model);
  const model = models.find((candidate) => candidate.id === modelId);
  return model ? { providerID: model.providerID, id: model.modelID } : undefined;
}

export function reconcileEnabledModelIds(
  models: ModelOption[],
  storedEnabledModelIds: string[] = [],
  storedKnownModelIds: string[] = [],
  autoEnableNewModels = true,
) {
  // A reconnect can briefly expose no models. Do not interpret that as "the
  // user enabled nothing" or erase choices for providers that are still loading.
  if (!models.length) {
    return { enabledModelIds: [...storedEnabledModelIds], knownModelIds: [...storedKnownModelIds] };
  }

  const available = models.map((model) => model.id);
  const availableModelIds = new Set(available);
  const known = new Set(storedKnownModelIds);
  const enabled = new Set(storedEnabledModelIds);
  const hasAvailableSelection = storedEnabledModelIds.some((id) => availableModelIds.has(id));

  // Seed new profiles, preserve explicit opt-outs, and keep the old fallback
  // when a previously enabled catalog no longer resolves at all.
  if ((!storedKnownModelIds.length && !storedEnabledModelIds.length && autoEnableNewModels)
    || (storedEnabledModelIds.length > 0 && !hasAvailableSelection)) {
    enabled.clear();
    available.forEach((id) => enabled.add(id));
  // shortcut: first legacy catalog may miss additions from downtime; migrate cached catalog IDs if this matters.
  } else if (autoEnableNewModels && storedKnownModelIds.length > 0) {
    available.filter((id) => !known.has(id)).forEach((id) => enabled.add(id));
  }

  // shortcut: retain known IDs for temporarily absent providers so returning models keep their opt-outs; prune only if catalog history becomes a storage concern.
  return {
    enabledModelIds: [...enabled],
    knownModelIds: [...new Set([...storedKnownModelIds, ...available])],
  };
}

export function recordRecentModelId(recentModelIds: string[], modelId?: string) {
  if (!modelId) {
    return recentModelIds;
  }

  return [modelId, ...recentModelIds.filter((id) => id !== modelId)].slice(0, 4);
}

export function getConfiguredProviderIds(config: Config | undefined, connected: string[], models: ModelOption[]) {
  const disabled = new Set(config?.disabled_providers || []);
  const configured = new Set<string>([
    ...(config?.enabled_providers || []),
    ...connected,
    ...Object.keys((config?.provider as Record<string, unknown>) || {}),
  ]);

  if (config?.model) {
    const configModelId = resolveConfigModelId(models, config.model);
    const modelMatch = configModelId ? models.find((model) => model.id === configModelId) : undefined;
    if (modelMatch) {
      configured.add(modelMatch.providerID);
    }
  }

  disabled.forEach((providerId) => configured.delete(providerId));

  return configured;
}

export function getSelectedModelParts(modelId?: string) {
  if (!modelId) {
    return undefined;
  }

  const providerID = modelId.split('/')[0];
  const selectedModelID = modelId.split('/').slice(1).join('/');
  if (!providerID || !selectedModelID) {
    return undefined;
  }

  return {
    providerID,
    modelID: selectedModelID,
  };
}

export function getVisibleModels(models: ModelOption[], configuredProviders: { id: string }[], enabledModelIds: string[]) {
  const providers = new Set(configuredProviders.map((provider) => provider.id));
  const enabled = new Set(enabledModelIds);
  return models.filter((model) => providers.has(model.providerID) && (enabled.size === 0 || enabled.has(model.id)));
}

