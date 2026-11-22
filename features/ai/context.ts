import { useMemo } from 'react';

import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useAppCore, useProjectScope } from '@/runtime/core';
import { useWorkspacePreferences } from '@/runtime/workspace';

import { getConfiguredProviders } from './model/selectors';
import type { CapabilitiesContextValue } from './model/types';
import { createProviderCommands } from './services/provider-commands';
import { useCapabilitiesCatalog } from './state/use-capabilities-catalog';
import { useModelRouting } from './state/use-model-routing';

export function useCapabilities(target?: WorkspaceTarget): CapabilitiesContextValue {
  const scope = useProjectScope(target);
  const { client, identity, isCurrentClient, queryActive } = scope;
  const { queryClient } = useAppCore();
  const { chatPreferences } = useWorkspacePreferences(target);
  const { currentConfig, availableProviders, providerAuthMethodsById, availableModels, availableAgents } =
    useCapabilitiesCatalog(identity, client, true, false);
  const modelRouting = useModelRouting({ ...scope, availableProviders, availableModels, chatPreferences });
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const commands = useMemo(() => createProviderCommands(queryClient, { client, identity, isCurrentClient, queryActive }),
    [client, identity, isCurrentClient, queryActive, queryClient]);
  return useMemo(() => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, modelRouting, ...commands }),
    [availableAgents, availableModels, availableProviders, commands, configuredProviders, currentConfig, modelRouting, providerAuthMethodsById]);
}
