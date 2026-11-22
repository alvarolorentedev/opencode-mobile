import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { CachedCapabilities } from '@/features/ai/services/capabilities-snapshot';
import { getConfiguredProviderIds, getInitialMode, reconcileEnabledModelIds } from '@/features/ai/model/opencode-model-selection';

import { useModelRouting, type ModelRoutingInput } from './use-model-routing';

type CapabilitiesActionsInput = ModelRoutingInput & {
  isHydrated: boolean;
  activeProjectPath?: string;
  capabilities?: CachedCapabilities;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
};

export function useCapabilitiesActions(input: CapabilitiesActionsInput) {
  const { isHydrated, client, activeProjectPath, capabilities, isCurrentClient, chatPreferences, setChatPreferences } = input;
  useModelRouting(input, true);

  const applyCapabilities = useCallback((result: CachedCapabilities) => {
    setChatPreferences((current) => {
      if (!isCurrentClient(client)) return current;
      const configuredProviderIds = getConfiguredProviderIds(result.config, result.connected, result.models);
      const configuredModels = result.models.filter((model) => configuredProviderIds.has(model.providerID));
      const { enabledModelIds, knownModelIds } = reconcileEnabledModelIds(
        configuredModels,
        current.enabledModelIds,
        current.knownModelIds,
        current.autoEnableNewModels,
      );
      const mode = getInitialMode(result.agents, result.config, current.mode) ?? current.mode;

      return {
        ...current,
        mode,
        enabledModelIds,
        knownModelIds,
        autoApprove: client.__opencode.contract === 'v2' ? current.autoApprove : false,
      };
    });
  }, [client, isCurrentClient, setChatPreferences]);
  useEffect(() => {
    if (isHydrated && capabilities && activeProjectPath) applyCapabilities(capabilities);
  }, [activeProjectPath, applyCapabilities, capabilities, chatPreferences.mode, isHydrated]);

}
