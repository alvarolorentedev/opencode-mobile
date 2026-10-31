import type { ProviderOption } from '@/features/ai/model/types';

export function getConfiguredProviders(availableProviders: ProviderOption[]) {
  return availableProviders.filter((provider) => provider.configured);
}
