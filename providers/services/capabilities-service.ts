import { getConfiguredProviderIds } from '@/providers/opencode-provider-utils';

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
  const nextModels = (providersResponse.data.all as any[])
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
    .sort((left: any, right: any) => left.label.localeCompare(right.label));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providersResponse.data.connected, nextModels);
  const configuredModels = nextModels.filter((model: any) => configuredProviderIds.has(model.providerID));
  const nextProviders = (providersResponse.data.all as any[])
    .map((provider: any) => ({
      id: provider.id,
      label: provider.name,
      modelCount: Object.keys(provider.models).length,
      configured: configuredProviderIds.has(provider.id),
    }))
    .sort((left: any, right: any) => left.label.localeCompare(right.label));
  const nextAgents = agentsResponse.data.map((a: any) => a);

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
