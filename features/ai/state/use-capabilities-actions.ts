import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { getLocalAutoModelStatus } from '@/features/ai/model/auto-model/models';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { CachedCapabilities } from '@/features/ai/services/capabilities-snapshot';
import { getClassifierModelId } from '@/features/ai/model/opencode-auto-model';
import type { ModelOption } from '@/shared/contracts/model-options';
import { getConfiguredProviderIds, getInitialMode, getVisibleModels, reconcileEnabledModelIds } from '@/features/ai/model/opencode-model-selection';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ProviderOption } from '@/features/ai/model/types';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
import { CLASSIFIER_PROBE_STALE_MS, probeServerClassifier, type ServerClassifierStatus } from '@/features/ai/services/model-routing-service';

const CLASSIFIER_QUERY_META = { retainOnCredentialRenewal: false };
type ClassifierResult = Awaited<ReturnType<typeof probeServerClassifier>>;

type CapabilitiesActionsInput = {
  identity: QueryIdentity;
  scopeKey: string;
  isHydrated: boolean;
  client: ScopedOpencodeClient;
  activeProjectPath?: string;
  isCurrentClient: (candidate: object) => boolean;
  capabilities?: CachedCapabilities;
  availableProviders: ProviderOption[];
  availableModels: ModelOption[];
  chatPreferences: ChatPreferences;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
};

export function useCapabilitiesActions({
  identity,
  scopeKey,
  isHydrated,
  client,
  activeProjectPath,
  capabilities,
  isCurrentClient,
  availableProviders,
  availableModels,
  chatPreferences,
  setChatPreferences,
}: CapabilitiesActionsInput) {
  const cache = useQueryClient();
  const { store } = useAppCore();
  const connectionScope = JSON.stringify([identity.connectionId, identity.connectionScope, identity.authRevision, activeProjectPath]);
  const probeOwner = useMemo(() => Symbol(`${scopeKey}:${connectionScope}:${client.__opencode.contract}`), [client, connectionScope, scopeKey]);
  const savedProbe = useAppStore((state) => state.workspaceUi[scopeKey]?.classifierProbe);
  const probe = savedProbe?.owner === probeOwner ? savedProbe : undefined;
  const localReady = useAppStore((state) => state.localClassifierReady);
  const probeResult = useQuery<ClassifierResult>({
    queryKey: projectQueryKey(identity, client, 'classifier-probe', probe?.model?.providerId, probe?.model?.modelId),
    queryFn: skipToken,
    meta: CLASSIFIER_QUERY_META,
  });
  const probedClassifierRef = useRef<string | undefined>(undefined);
  const probeRequest = useRef(0);
  const visibleModels = useMemo(
    () => getVisibleModels(availableModels, availableProviders.filter((provider) => provider.configured), chatPreferences.enabledModelIds),
    [availableModels, availableProviders, chatPreferences.enabledModelIds],
  );
  const serverClassifierStatus: ServerClassifierStatus = probe?.status ?? probeResult.data?.status ?? 'unknown';

  const checkServerClassifier = useCallback(async (modelId?: string) => {
    const request = ++probeRequest.current;
    const classifierModelId = modelId ?? getClassifierModelId(chatPreferences.autoModel, visibleModels);
    const model = classifierModelId
      ? visibleModels.find((candidate) => candidate.id === classifierModelId)
      : undefined;
    if (!model) {
      store.getState().setWorkspaceUi(scopeKey, { classifierProbe: { owner: probeOwner, status: 'unavailable' } });
      return 'unavailable' as const;
    }
    if (client.__opencode.contract !== 'v2' || !client.api?.generate || !isCurrentClient(client)) {
      store.getState().setWorkspaceUi(scopeKey, { classifierProbe: { owner: probeOwner, status: 'unsupported' } });
      return 'unsupported' as const;
    }

    const selection = { providerId: model.providerID, modelId: model.modelID };
    store.getState().setWorkspaceUi(scopeKey, { classifierProbe: { owner: probeOwner, model: selection, status: 'checking' } });
    let result: ClassifierResult;
    try {
      result = await cache.fetchQuery<ClassifierResult>({
        queryKey: projectQueryKey(identity, client, 'classifier-probe', model.providerID, model.modelID),
        queryFn: () => probeServerClassifier({ client, modelID: model.modelID, providerID: model.providerID }),
        staleTime: (query) => query.state.data?.cacheable ? CLASSIFIER_PROBE_STALE_MS : 0,
        networkMode: 'always',
        meta: CLASSIFIER_QUERY_META,
      });
    } catch {
      if (isCurrentClient(client) && probeRequest.current === request && store.getState().workspaceUi[scopeKey]?.classifierProbe?.owner === probeOwner) {
        store.getState().setWorkspaceUi(scopeKey, { classifierProbe: { owner: probeOwner, status: 'unavailable' } });
      }
      return 'unavailable' as const;
    }
    if (!isCurrentClient(client) || probeRequest.current !== request || store.getState().workspaceUi[scopeKey]?.classifierProbe?.owner !== probeOwner) return 'unavailable' as const;
    store.getState().setWorkspaceUi(scopeKey, { classifierProbe: { owner: probeOwner, model: selection } });
    probedClassifierRef.current = `${connectionScope}:${model.id}`;
    return result.status;
  }, [cache, chatPreferences.autoModel, client, connectionScope, identity, isCurrentClient, probeOwner, scopeKey, store, visibleModels]);

  const resetServerClassifier = useCallback(() => {
    probedClassifierRef.current = undefined;
    probeRequest.current++;
    store.getState().setWorkspaceUi(scopeKey, { classifierProbe: undefined });
  }, [scopeKey, store]);

  const refreshAvailability = useCallback(() => {
    store.getState().setLocalClassifierReady(getLocalAutoModelStatus() === 'ready');
  }, [store]);

  useLayoutEffect(() => {
    if (store.getState().localClassifierReady === undefined) refreshAvailability();
  }, [refreshAvailability, store]);

  useLayoutEffect(() => {
    probedClassifierRef.current = undefined;
    probeRequest.current++;
  }, [probeOwner]);

  // Availability is derived for the UI and the send-time guards. It must never
  // rewrite the persisted routing choice: an unreadable pack, a slow catalog or
  // a pending probe is not a user decision to turn routing off.

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

  const modelRouting = useMemo(() => ({
    available: chatPreferences.autoModel.classifier === 'local' ? localReady === true : serverClassifierStatus === 'available',
    serverStatus: serverClassifierStatus,
    checkServerClassifier,
    resetServerClassifier,
    refreshAvailability,
  }), [chatPreferences.autoModel.classifier, localReady, serverClassifierStatus, checkServerClassifier, resetServerClassifier, refreshAvailability]);

  return modelRouting;
}
