import { getConfiguredProviderIds, toAgentOption } from '@/providers/opencode-provider-utils';

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

export async function discoverChatCapabilities(client: any, activeProjectPath?: string) {
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

  const nextConfig = configResponse.data;
  const nextModels = uniqueById((providersResponse.data.all as any[])
    .flatMap((provider: any) =>
      Object.values(provider.models).map((model: any) => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        supportsReasoning: model.reasoning,
      })),
    )
    .sort((left: any, right: any) => left.label.localeCompare(right.label)));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providersResponse.data.connected, nextModels);
  const configuredModels = nextModels.filter((model: any) => configuredProviderIds.has(model.providerID));
  const nextProviders = uniqueById((providersResponse.data.all as any[])
    .map((provider: any) => ({
      id: provider.id,
      label: provider.name,
      modelCount: Object.keys(provider.models).length,
      configured: configuredProviderIds.has(provider.id),
    }))
    .sort((left: any, right: any) => left.label.localeCompare(right.label)));
  const nextAgents = uniqueById(agentsResponse.data.map((agent: any) => toAgentOption(agent)));

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providersResponse.data.connected,
    providerAuthMethodsById: (providerAuthResponse.data || {}) as Record<string, any[]>,
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
