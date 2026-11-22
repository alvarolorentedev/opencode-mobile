import { useMemo } from 'react';

import { getConfiguredProviders } from '../model/selectors';
import type { CapabilitiesContextValue } from '../model/types';
import type { useCapabilitiesActions } from './use-capabilities-actions';

export function useCapabilitiesPresentation(
  { currentConfig, availableProviders, providerAuthMethodsById, availableModels, availableAgents }: Pick<CapabilitiesContextValue,
  'currentConfig' | 'availableProviders' | 'providerAuthMethodsById' | 'availableModels' | 'availableAgents'>,
  { setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth,
    cancelProviderOAuth, addProviderAccount, activateProviderAccount, removeProviderAccount, modelRouting }: ReturnType<typeof useCapabilitiesActions>,
): CapabilitiesContextValue {
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  return useMemo(() => ({
    currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents,
    setProviderAuth, removeProvider, providerOAuth: {
      start: startProviderOAuth, complete: completeProviderOAuth, completeAutomatic: completeAutomaticProviderOAuth, cancel: cancelProviderOAuth,
    },
    providerAccounts: { add: addProviderAccount, activate: activateProviderAccount, remove: removeProviderAccount },
    modelRouting,
  }), [currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents,
    setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth, cancelProviderOAuth,
    addProviderAccount, activateProviderAccount, removeProviderAccount, modelRouting]);
}
