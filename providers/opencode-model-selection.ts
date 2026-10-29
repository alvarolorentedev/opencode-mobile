import type { Agent, Config, Model } from '@/lib/opencode/types';
import { defaultChatPreferences } from '@/providers/opencode-preferences';

// Model/provider/agent catalog shapes and the pure selection rules that keep the
// stored choice valid against the current server catalog.

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  variants: { id: string }[];
  supportsReasoning: boolean;
  supportsAttachments: boolean;
  inputModalities: ('text' | 'audio' | 'image' | 'video' | 'pdf')[];
  supportsToolCalls: boolean;
  status?: 'alpha' | 'beta' | 'deprecated' | 'active';
  contextLimit?: number;
  outputLimit?: number;
  pricing?: Model['cost'];
};

export function getSelectedModelVariant(
  modelId: string | undefined,
  selections: Record<string, string | null>,
  models: ModelOption[],
  sessionModel?: { providerID: string; id: string; variant?: string },
) {
  const model = models.find((item) => item.id === modelId);
  if (!model) return undefined;

  if (Object.prototype.hasOwnProperty.call(selections, model.id)) {
    const selected = selections[model.id];
    return selected !== null && model.variants.some((variant) => variant.id === selected) ? selected : undefined;
  }

  return sessionModel?.providerID === model.providerID
    && sessionModel.id === model.modelID
    && model.variants.some((variant) => variant.id === sessionModel.variant)
    ? sessionModel.variant
    : undefined;
}

export type AgentOption = {
  id: string;
  label: string;
  description?: string;
};

export function toAgentOption(agent: Agent): AgentOption {
  return {
    id: agent.name,
    label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
    description: agent.description,
  };
}

export function getInitialMode(agents: AgentOption[], config?: Config, storedMode?: string) {
  if (storedMode && agents.some((agent) => agent.id === storedMode)) {
    return storedMode;
  }
  // A capability read can be empty while a server reconnects. Keep the stored
  // agent instead of replacing it with the default until agents are available.
  if (!agents.length) {
    return storedMode ?? defaultChatPreferences.mode;
  }

  const configuredAgent = config?.agent
    ? Object.entries(config.agent).find(([, value]) => value && value.disable !== true)?.[0]
    : undefined;
  if (configuredAgent && agents.some((agent) => agent.id === configuredAgent)) {
    return configuredAgent;
  }

  const preferred = agents.find((agent) => agent.id === 'build') || agents.find((agent) => agent.id === 'general');
  return preferred?.id || agents[0]?.id || defaultChatPreferences.mode;
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

export function getInitialModelId(models: ModelOption[], config?: Config, storedModelId?: string) {
  if (storedModelId && models.some((model) => model.id === storedModelId)) {
    return storedModelId;
  }

  // An empty catalog is a transient reconnect state, not proof that the stored
  // model disappeared. Keeping it lets the next successful read validate it.
  if (!models.length) {
    return storedModelId;
  }

  // No stored or server match: leave unset so prompts fall through to the
  // server's configured model instead of a possibly blocked auto-pick.
  return resolveConfigModelId(models, config?.model);
}

export function getInitialProviderId(models: ModelOption[], config?: Config, storedProviderId?: string, modelId?: string) {
  if (storedProviderId && models.some((model) => model.providerID === storedProviderId)) {
    return storedProviderId;
  }

  if (!models.length) {
    return storedProviderId;
  }

  const modelMatch = models.find((model) => model.id === modelId);
  if (modelMatch) {
    return modelMatch.providerID;
  }

  const configModelId = resolveConfigModelId(models, config?.model);
  const configMatch = configModelId ? models.find((model) => model.id === configModelId) : undefined;
  if (configMatch) {
    return configMatch.providerID;
  }

  return undefined;
}

export function getModelIdForProvider(models: ModelOption[], providerId?: string, selectedModelId?: string, preferredModelId?: string) {
  const providerModels = providerId ? models.filter((model) => model.providerID === providerId) : models;
  if (providerModels.length === 0) {
    return selectedModelId;
  }

  if (selectedModelId && providerModels.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }

  if (preferredModelId && providerModels.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }

  // No explicit or server-backed choice: leave unset so the server default
  // applies instead of silently sending a possibly blocked model.
  return undefined;
}

export function getEnabledModelIds(models: ModelOption[], storedModelIds?: string[]) {
  const stored = storedModelIds ?? [];
  // A reconnect can briefly expose no models. Do not interpret that as "the
  // user enabled nothing" or erase choices for providers that are still loading.
  if (!models.length) {
    return [...stored];
  }

  const available = models.map((model) => model.id);
  if (!stored.length) {
    return available;
  }
  // Keep stored IDs that are currently unavailable alongside the ones that
  // resolved. The picker only renders available models, so a provider that is
  // still loading can return without losing its enabled selection. If none of
  // the stored IDs exist at all, fall back to the full catalog so the user is
  // not left with an empty picker.
  const availableModelIds = new Set(available);
  return stored.some((modelId) => availableModelIds.has(modelId)) ? [...new Set(stored)] : available;
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
