import type { OpencodeClient, ProviderAuthMethod, ProviderListResponse } from '@opencode-ai/sdk/client';

import { getConfiguredProviderIds, toAgentOption } from '@/providers/opencode-provider-utils';

type DiscoveredModel = ProviderListResponse['all'][number]['models'][string];

export type CapabilityModel = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  attachment: boolean;
  supportsAttachments: boolean;
  inputModalities: ('text' | 'audio' | 'image' | 'video' | 'pdf')[];
  supportsToolCalls: boolean;
  contextLimit?: number;
  outputLimit?: number;
  modalities?: DiscoveredModel['modalities'];
  supportsReasoning: boolean;
  reasoning: boolean;
  toolcall: boolean;
  status?: DiscoveredModel['status'];
  limit: DiscoveredModel['limit'];
};

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
      Object.values(provider.models).map((model): CapabilityModel => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        attachment: model.attachment,
        modalities: model.modalities,
        supportsReasoning: model.reasoning,
        supportsAttachments: model.attachment || Boolean(model.modalities?.input.some((modality) => modality !== 'text')),
        inputModalities: model.modalities?.input || ['text'],
        supportsToolCalls: model.tool_call,
        contextLimit: model.limit?.context,
        outputLimit: model.limit?.output,
        reasoning: model.reasoning,
        toolcall: model.tool_call,
        status: model.status,
        limit: model.limit,
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
  const providerAuthMethodsById = Object.fromEntries(
    Object.entries(authData).map(([providerId, methods]) => [
      providerId,
      methods.map(({ type, label }): ProviderAuthMethod => ({ type, label })),
    ]),
  );

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById,
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
