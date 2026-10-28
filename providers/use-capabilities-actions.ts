import { getProviders, setProviderCredentialsForClient, removeProviderCredentials, startProviderAuthorization, completeProviderAuthorization } from '@/providers/services/capabilities-service';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { getLocalAutoModelStatus } from '@/lib/auto-model/models';
import { normalizeAutoModelPreferences } from '@/lib/auto-model/preferences';
import type { Config, Reference, Skill } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { hydrateCapabilitiesCache, persistCapabilitiesCache, type CachedCapabilities } from '@/providers/capabilities-cache';
import { getClassifierModelId } from '@/providers/opencode-auto-model';
import {
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  getVisibleModels,
  recordRecentModelId,
} from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { AgentOption, ModelOption } from '@/providers/opencode-model-selection';
import type { ProviderAuthMethod, ProviderAuthValues, ProviderOption } from '@/providers/opencode-provider-types';
import { probeServerClassifier, type ServerClassifierStatus } from '@/providers/services/model-routing-service';

type CapabilitiesActionsInput = {
  client: ScopedOpencodeClient;
  activeProjectPath?: string;
  connectionScope: string;
  isCurrentClient: (candidate: object) => boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  availableModels: ModelOption[];
  chatPreferences: ChatPreferences;
  setCurrentConfig: Dispatch<SetStateAction<Config | undefined>>;
  setAvailableProviders: Dispatch<SetStateAction<ProviderOption[]>>;
  setProviderAuthMethodsById: Dispatch<SetStateAction<Record<string, ProviderAuthMethod[]>>>;
  setAvailableModels: Dispatch<SetStateAction<ModelOption[]>>;
  setAvailableAgents: Dispatch<SetStateAction<AgentOption[]>>;
  setAvailableSkills: Dispatch<SetStateAction<Skill[]>>;
  setAvailableReferences: Dispatch<SetStateAction<Reference[]>>;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
};

export function useCapabilitiesActions({
  client,
  activeProjectPath,
  connectionScope,
  isCurrentClient,
  availableProviders,
  availableModels,
  chatPreferences,
  setCurrentConfig,
  setAvailableProviders,
  setProviderAuthMethodsById,
  setAvailableModels,
  setAvailableAgents,
  setAvailableSkills,
  setAvailableReferences,
  setChatPreferences,
}: CapabilitiesActionsInput) {
  const [serverProbe, setServerProbe] = useState<{ client: ScopedOpencodeClient; scope: string; status: ServerClassifierStatus }>(() => ({
    client,
    scope: connectionScope,
    status: 'unknown',
  }));
  const [localStatus, setLocalStatus] = useState(() => getLocalAutoModelStatus());
  const probedClassifierRef = useRef<string | undefined>(undefined);
  const visibleModels = useMemo(
    () => getVisibleModels(availableModels, availableProviders.filter((provider) => provider.configured), chatPreferences.enabledModelIds),
    [availableModels, availableProviders, chatPreferences.enabledModelIds],
  );
  const serverClassifierStatus = serverProbe.client === client && serverProbe.scope === connectionScope
    ? serverProbe.status
    : 'unknown';
  const localReady = localStatus === 'ready';
  const setServerClassifierStatus = useCallback((status: ServerClassifierStatus) => {
    setServerProbe({ client, scope: connectionScope, status });
  }, [client, connectionScope]);

  const requireClient = useCallback(() => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before changing its providers.');
  }, [client, isCurrentClient]);

  const checkServerClassifier = useCallback(async (modelId?: string) => {
    const classifierModelId = modelId ?? getClassifierModelId(chatPreferences.autoModel, visibleModels);
    const model = classifierModelId
      ? visibleModels.find((candidate) => candidate.id === classifierModelId)
      : undefined;
    if (!model) {
      setServerClassifierStatus('unavailable');
      return 'unavailable' as const;
    }
    if (client.__opencode.contract !== 'v2' || !client.api?.generate || !isCurrentClient(client)) {
      setServerClassifierStatus('unsupported');
      return 'unsupported' as const;
    }

    setServerClassifierStatus('checking');
    const status = await probeServerClassifier({
      client,
      connectionScope,
      modelID: model.modelID,
      providerID: model.providerID,
    });
    if (!isCurrentClient(client)) {
      return 'unavailable' as const;
    }
    setServerClassifierStatus(status);
    probedClassifierRef.current = `${connectionScope}:${model.id}`;
    return status;
  }, [chatPreferences.autoModel, client, connectionScope, isCurrentClient, setServerClassifierStatus, visibleModels]);

  const resetServerClassifier = useCallback(() => {
    probedClassifierRef.current = undefined;
    setServerClassifierStatus('unknown');
  }, [setServerClassifierStatus]);

  const refreshAvailability = useCallback(() => {
    setLocalStatus(getLocalAutoModelStatus());
  }, []);

  useLayoutEffect(() => {
    probedClassifierRef.current = undefined;
  }, [client, connectionScope]);

  useEffect(() => {
    if (!chatPreferences.autoModel.enabled || chatPreferences.autoModel.classifier !== 'local' || localReady) {
      return;
    }
    setChatPreferences((current) => current.autoModel.enabled
      ? { ...current, autoModel: { ...current.autoModel, enabled: false } }
      : current);
  }, [chatPreferences.autoModel, localReady, setChatPreferences]);

  useEffect(() => {
    if (!chatPreferences.autoModel.enabled || chatPreferences.autoModel.classifier !== 'server') {
      return;
    }
    if (serverClassifierStatus !== 'unsupported' && serverClassifierStatus !== 'auth') {
      return;
    }
    setChatPreferences((current) => current.autoModel.enabled
      ? { ...current, autoModel: { ...current.autoModel, enabled: false } }
      : current);
  }, [chatPreferences.autoModel, serverClassifierStatus, setChatPreferences]);

  useEffect(() => {
    const preferences = chatPreferences.autoModel;
    if (!preferences.enabled || preferences.classifier !== 'server' || client.__opencode.contract !== 'v2') {
      return;
    }
    const modelId = getClassifierModelId(preferences, visibleModels);
    if (!modelId) {
      return;
    }
    const key = `${connectionScope}:${modelId}`;
    if (probedClassifierRef.current === key) {
      return;
    }
    probedClassifierRef.current = key;
    void checkServerClassifier(modelId);
  }, [chatPreferences.autoModel, checkServerClassifier, client.__opencode.contract, connectionScope, visibleModels]);

  const applyCapabilities = useCallback((result: CachedCapabilities) => {
    setCurrentConfig(result.config);
    setAvailableProviders(result.providers);
    setProviderAuthMethodsById(result.providerAuthMethodsById);
    setAvailableModels(result.models);
    setAvailableAgents(result.agents);
    setAvailableSkills(result.skills ?? []);
    setAvailableReferences(result.references ?? []);

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
        autoApprove: client.__opencode.contract === 'v2' ? current.autoApprove : false,
      };
    });
  }, [client.__opencode.contract, setAvailableAgents, setAvailableModels, setAvailableProviders, setAvailableReferences, setAvailableSkills, setChatPreferences, setCurrentConfig, setProviderAuthMethodsById]);

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
        skills: result.skills,
        references: result.references,
      });
    }
  }, [activeProjectPath, applyCapabilities, client, connectionScope, isCurrentClient]);

  const setProviderAuth = useCallback(
    async (providerId: string, values: ProviderAuthValues) => {
      requireClient();
      const key = typeof values.key === 'string' ? values.key.trim() : '';
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      await setProviderCredentialsForClient(client, providerId, values);
      await refreshChatCapabilities();
    },
    [client, requireClient, refreshChatCapabilities],
  );

  const removeProvider = useCallback(async (providerId: string) => {
    requireClient();
    await removeProviderCredentials(client, providerId);
    await refreshChatCapabilities();
  }, [client, requireClient, refreshChatCapabilities]);

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
      await refreshChatCapabilities();
      return;
    }
    const deadline = Date.now() + 900_000;
    for (;;) {
      const providers = await getProviders(client);
      if (providers?.connected.includes(providerId)) {
        await refreshChatCapabilities();
        return;
      }
      if (!isCurrentClient(client) || Date.now() >= deadline) {
        throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }, [client, isCurrentClient, refreshChatCapabilities, requireClient]);

  const cancelProviderOAuth = useCallback(async (providerId: string) => {
    requireClient();
    if (!client.providerOAuth) return;
    await client.providerOAuth.cancel(providerId);
  }, [client, requireClient]);

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    requireClient();
    await completeProviderAuthorization(client, providerId, methodIndex, code);
    await refreshChatCapabilities();
  }, [client, requireClient, refreshChatCapabilities]);

  const addProviderAccount = useCallback(async (providerId: string, values: ProviderAuthValues, label?: string) => {
    requireClient();
    if (!client.accounts) throw new Error('Managing multiple provider accounts requires OpenCode 2.');
    await client.accounts.add(providerId, values, label);
  }, [client, requireClient]);

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
        autoModel: patch.autoModel ? normalizeAutoModelPreferences(patch.autoModel) : current.autoModel,
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
      if (client.__opencode.contract !== 'v2') throw new Error('Auto-approve is available on OpenCode 2 only.');
      setChatPreferences((current) => ({ ...current, autoApprove: enabled }));
    },
    [client, setChatPreferences],
  );

  const modelRouting = useMemo(() => ({
    available: chatPreferences.autoModel.classifier === 'local' ? localReady : serverClassifierStatus === 'available',
    serverStatus: serverClassifierStatus,
    checkServerClassifier,
    resetServerClassifier,
    refreshAvailability,
  }), [chatPreferences.autoModel.classifier, localReady, serverClassifierStatus, checkServerClassifier, resetServerClassifier, refreshAvailability]);

  return {
    refreshChatCapabilities,
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
    modelRouting,
  };
}
