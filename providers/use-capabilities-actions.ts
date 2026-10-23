import { getConfig, updateConfig, getProviders, setProviderCredentialsForClient, removeProviderCredentials, startProviderAuthorization, completeProviderAuthorization } from '@/providers/services/capabilities-service';
import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { Config } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { hydrateCapabilitiesCache, persistCapabilitiesCache, type CachedCapabilities } from '@/providers/capabilities-cache';
import { isAutoApproveEnabled, mergePermissionConfig } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  recordRecentModelId,
} from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ProviderAuthMethod, ProviderAuthValues, ProviderOption } from '@/providers/opencode-provider-types';

type CapabilitiesActionsInput = {
  client: ScopedOpencodeClient;
  activeProjectPath?: string;
  connectionScope: string;
  isCurrentClient: (candidate: object) => boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  availableModels: ModelOption[];
  setCurrentConfig: Dispatch<SetStateAction<Config | undefined>>;
  setAvailableProviders: Dispatch<SetStateAction<ProviderOption[]>>;
  setProviderAuthMethodsById: Dispatch<SetStateAction<Record<string, ProviderAuthMethod[]>>>;
  setAvailableModels: Dispatch<SetStateAction<ModelOption[]>>;
  setAvailableAgents: Dispatch<SetStateAction<AgentOption[]>>;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
};

export function useCapabilitiesActions({
  client,
  activeProjectPath,
  connectionScope,
  isCurrentClient,
  currentConfig,
  availableProviders,
  availableModels,
  setCurrentConfig,
  setAvailableProviders,
  setProviderAuthMethodsById,
  setAvailableModels,
  setAvailableAgents,
  setChatPreferences,
}: CapabilitiesActionsInput) {
  const requireClient = useCallback(() => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before changing its providers.');
  }, [client, isCurrentClient]);

  const applyCapabilities = useCallback((result: CachedCapabilities) => {
    setCurrentConfig(result.config);
    setAvailableProviders(result.providers);
    setProviderAuthMethodsById(result.providerAuthMethodsById);
    setAvailableModels(result.models);
    setAvailableAgents(result.agents);

    setChatPreferences((current) => {
      const configuredProviderIds = getConfiguredProviderIds(result.config, result.connected, result.models);
      const configuredModels = result.models.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = getInitialProviderId(configuredModels, result.config, current.providerId, current.modelId);
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, result.config, current.providerId, current.modelId);

      return {
        ...current,
        mode: getInitialMode(result.agents, result.config, current.mode),
        providerId: safeProviderId,
        modelId: getModelIdForProvider(
          enabledModels,
          safeProviderId,
          getInitialModelId(enabledModels, result.config, current.modelId),
          safeProviderId ? current.providerModelSelections[safeProviderId] : undefined,
        ),
        enabledModelIds,
        autoApprove: client.__opencode.contract === 'v2' ? current.autoApprove : isAutoApproveEnabled(result.config),
      };
    });
  }, [client.__opencode.contract, setAvailableAgents, setAvailableModels, setAvailableProviders, setChatPreferences, setCurrentConfig, setProviderAuthMethodsById]);

  const hydratedRef = useRef<{ key: string; client: object } | undefined>(undefined);
  const freshRef = useRef(false);
  const clientRef = useRef(client);
  useLayoutEffect(() => {
    if (clientRef.current !== client) {
      clientRef.current = client;
      freshRef.current = false;
    }
  }, [client]);
  useEffect(() => {
    if (!activeProjectPath) return;
    const key = `${connectionScope}\u0000${activeProjectPath}`;
    if (hydratedRef.current?.key === key && hydratedRef.current.client === client) return;
    hydratedRef.current = { key, client };
    void hydrateCapabilitiesCache(connectionScope, activeProjectPath, (cached) => {
      if (!freshRef.current) applyCapabilities(cached);
    }, () => isCurrentClient(client));
  }, [activeProjectPath, applyCapabilities, client, connectionScope, isCurrentClient]);

  const refreshChatCapabilities = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    const result = await import('@/providers/services/capabilities-service').then((m) => m.discoverChatCapabilities(client, activeProjectPath));
    if (!isCurrentClient(client)) {
      return;
    }

    freshRef.current = true;
    applyCapabilities(result);
    if (activeProjectPath) {
      void persistCapabilitiesCache(connectionScope, activeProjectPath, {
        config: result.config,
        providers: result.providers,
        connected: result.connected,
        providerAuthMethodsById: result.providerAuthMethodsById,
        models: result.models,
        agents: result.agents,
      });
    }
  }, [activeProjectPath, applyCapabilities, client, connectionScope, isCurrentClient]);

  const configureProvider = useCallback(
    async (providerId: string) => {
      requireClient();
      const latestConfig = currentConfig || await getConfig(client);
    requireClient();
      if (!latestConfig) {
        throw new Error('OpenCode did not return its configuration.');
      }
      const enabledProviders = new Set(latestConfig.enabled_providers || []);
      enabledProviders.add(providerId);

      const updatedConfig = client.compatibility ? await updateConfig(client, {
        ...latestConfig,
        disabled_providers: (latestConfig.disabled_providers || []).filter((id) => id !== providerId),
        enabled_providers: [...enabledProviders].sort(),
      }) : latestConfig;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      requireClient();
      setCurrentConfig(updatedConfig);
      await refreshChatCapabilities();
      setChatPreferences((current) => ({
        ...current,
        providerId: current.providerId || providerId,
      }));
    },
    [client, requireClient, currentConfig, refreshChatCapabilities, setChatPreferences, setCurrentConfig],
  );

  const setProviderAuth = useCallback(
    async (providerId: string, values: ProviderAuthValues) => {
      requireClient();
      const key = typeof values.key === 'string' ? values.key.trim() : '';
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      await setProviderCredentialsForClient(client, providerId, values);
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, requireClient, configureProvider, refreshChatCapabilities],
  );

  const removeProvider = useCallback(async (providerId: string) => {
    requireClient();
    await removeProviderCredentials(client, providerId);
    const latestConfig = currentConfig || await getConfig(client);
    requireClient();
    if (latestConfig && client.compatibility) {
      const updatedConfig = await updateConfig(client, {
        ...latestConfig,
        disabled_providers: [...new Set([...(latestConfig.disabled_providers || []), providerId])].sort(),
        enabled_providers: (latestConfig.enabled_providers || []).filter((id) => id !== providerId),
      });
      requireClient();
      setCurrentConfig(updatedConfig);
    }
    await refreshChatCapabilities();
  }, [client, requireClient, currentConfig, refreshChatCapabilities, setCurrentConfig]);

  const startProviderOAuth = useCallback(
    async (providerId: string, methodIndex: number, inputs?: ProviderAuthValues) => {
    requireClient();
      const authorization = await startProviderAuthorization(client, providerId, methodIndex, inputs);
      if (!authorization) {
        throw new Error('OpenCode did not return OAuth authorization details.');
      }

      return {
        url: authorization.url,
        instructions: authorization.instructions,
        method: authorization.method,
      };
    },
    [client, requireClient],
  );

  const completeAutomaticProviderOAuth = useCallback(async (providerId: string) => {
    requireClient();
    // On V2 the server owns the automatic OAuth callback, so wait on the attempt
    // status it records. V1 only exposes the connected provider list.
    if (client.providerOAuth) {
      await client.providerOAuth.wait(providerId);
      if (!isCurrentClient(client)) throw new Error('The connection changed before sign-in completed.');
      await configureProvider(providerId);
      return;
    }
    const deadline = Date.now() + 900_000;
    for (;;) {
      const providers = await getProviders(client);
      if (providers?.connected.includes(providerId)) {
        await configureProvider(providerId);
        return;
      }
      if (!isCurrentClient(client) || Date.now() >= deadline) {
        throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }, [client, requireClient, configureProvider, isCurrentClient]);

  const cancelProviderOAuth = useCallback(async (providerId: string) => {
    requireClient();
    if (!client.providerOAuth) return;
    await client.providerOAuth.cancel(providerId);
  }, [client, requireClient]);

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    requireClient();
    await completeProviderAuthorization(client, providerId, methodIndex, code);
    await configureProvider(providerId);
    await refreshChatCapabilities();
  }, [client, requireClient, configureProvider, refreshChatCapabilities]);

  const addProviderAccount = useCallback(async (providerId: string, values: ProviderAuthValues, label?: string) => {
    requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.add(providerId, values, label);
    await configureProvider(providerId);
  }, [client, requireClient, configureProvider]);

  const activateProviderAccount = useCallback(async (credentialId: string) => {
    requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.activate(credentialId);
    await refreshChatCapabilities();
  }, [client, requireClient, refreshChatCapabilities]);

  const removeProviderAccount = useCallback(async (credentialId: string) => {
    requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.remove(credentialId);
    await refreshChatCapabilities();
  }, [client, requireClient, refreshChatCapabilities]);

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
    setChatPreferences((current) => {
      const configuredProviderIds = new Set(availableProviders.filter((provider) => provider.configured).map((provider) => provider.id));
      const configuredModels = availableModels.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, patch.enabledModelIds ?? current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = patch.providerId ?? current.providerId;
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, undefined, current.providerId, patch.modelId ?? current.modelId);
      const requestedModelId = patch.modelId ?? current.modelId;
      const nextProviderModelSelections = patch.modelId
        ? {
            ...current.providerModelSelections,
            [patch.providerId ?? safeProviderId ?? patch.modelId.split('/')[0]]: patch.modelId,
          }
        : current.providerModelSelections;
      const nextModelId = getModelIdForProvider(
        enabledModels,
        safeProviderId,
        requestedModelId,
        safeProviderId ? nextProviderModelSelections[safeProviderId] : undefined,
      );

      return {
        ...current,
        ...patch,
        modelVariantSelections: patch.modelVariantSelections
          ? { ...current.modelVariantSelections, ...patch.modelVariantSelections }
          : current.modelVariantSelections,
        providerId: safeProviderId,
        modelId: nextModelId,
        enabledModelIds,
        recentModelIds: recordRecentModelId(current.recentModelIds, patch.modelId),
        providerModelSelections:
          safeProviderId && nextModelId
            ? {
                ...nextProviderModelSelections,
                [safeProviderId]: nextModelId,
              }
            : nextProviderModelSelections,
      };
    });
  }, [availableModels, availableProviders, setChatPreferences]);

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      if (client.__opencode.contract === 'v2') { setChatPreferences((current) => ({ ...current, autoApprove: enabled })); return; }
      const latestConfig = currentConfig || await getConfig(client);
    requireClient();
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const updatedConfig = await updateConfig(client, nextConfig);
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      requireClient();
      setCurrentConfig(updatedConfig);
      setChatPreferences((current) => ({
        ...current,
        autoApprove: enabled,
      }));
    },
    [client, requireClient, currentConfig, setChatPreferences, setCurrentConfig],
  );

  return {
    refreshChatCapabilities,
    configureProvider,
    setProviderAuth,
    removeProvider,
    startProviderOAuth,
    completeAutomaticProviderOAuth,
    completeProviderOAuth,
    cancelProviderOAuth,
    addProviderAccount,
    activateProviderAccount,
    removeProviderAccount,
    updateChatPreferences,
    setAutoApprove,
  };
}
