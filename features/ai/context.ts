import { useMemo } from 'react';

import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useAppCore, useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';

import { getConfiguredProviders } from './model/selectors';
import type { CapabilitiesContextValue } from './model/types';
import { createProviderCommands } from './services/provider-commands';
import { useCapabilitiesCatalog } from './state/use-capabilities-catalog';

export function useCapabilities(target?: WorkspaceTarget): CapabilitiesContextValue {
  const { client, identity, isCurrentClient, queryActive } = useProjectScope(target);
  const { queryClient } = useAppCore();
  const modelRouting = useWorkspaceDomainValue((values) => values.modelRouting, 'useCapabilities', target);
  const { currentConfig, availableProviders, providerAuthMethodsById, availableModels, availableAgents } =
    useCapabilitiesCatalog(identity, client, true, false);
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const commands = useMemo(() => createProviderCommands(queryClient, { client, identity, isCurrentClient, queryActive }),
    [client, identity, isCurrentClient, queryActive, queryClient]);
  return useMemo(() => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, modelRouting, ...commands }),
    [availableAgents, availableModels, availableProviders, commands, configuredProviders, currentConfig, modelRouting, providerAuthMethodsById]);
}
