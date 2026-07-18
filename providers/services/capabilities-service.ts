import type { OpencodeClient, ProviderListResponse } from '@opencode-ai/sdk/v2/client';

import { getConfiguredProviderIds, toAgentOption, type ModelOption } from '@/providers/opencode-provider-utils';

type DiscoveredModel = ProviderListResponse['all'][number]['models'][string];
const INPUT_MODALITIES: ModelOption['inputModalities'] = ['text', 'audio', 'image', 'video', 'pdf'];

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function discoverChatCapabilities(client: OpencodeClient, activeProjectPath?: string) {
  if (!activeProjectPath) {
    return {
      config: undefined,
      providers: [],
      providerAuthMethodsById: {},
      models: [],
      agents: [],
      connected: [],
      configuredModels: [],
    };
  }

  const [configResponse, providersResponse, providerAuthResponse, agentsResponse] = await Promise.all([
    client.config.get(),
    client.provider.list(),
    client.provider.auth(),
    client.app.agents(),
  ]);

  const nextConfig = requireData(configResponse.data, 'config request');
  const providerData = requireData(providersResponse.data, 'provider request');
  const authData = requireData(providerAuthResponse.data, 'provider auth request');
  const agentData = requireData(agentsResponse.data, 'agent request');
  const nextModels = uniqueById(providerData.all
    .flatMap((provider) =>
      Object.values(provider.models).map((model: DiscoveredModel): ModelOption => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        supportsReasoning: model.capabilities.reasoning,
        supportsAttachments: model.capabilities.attachment,
        inputModalities: INPUT_MODALITIES.filter((modality) => model.capabilities.input[modality]),
        supportsToolCalls: model.capabilities.toolcall,
        contextLimit: model.limit.context,
        outputLimit: model.limit.output,
        status: model.status,
      })),
    )
    .sort((left, right) => left.label.localeCompare(right.label)));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providerData.connected, nextModels);
  const configuredModels = nextModels.filter((model) => configuredProviderIds.has(model.providerID));
  const nextProviders = uniqueById(providerData.all
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      modelCount: Object.keys(provider.models).length,
      configured: configuredProviderIds.has(provider.id),
    }))
    .sort((left, right) => left.label.localeCompare(right.label)));
  const nextAgents = uniqueById(agentData.map(toAgentOption));

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById: authData,
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
