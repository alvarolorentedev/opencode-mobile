import { skipToken, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

import { getLocalAutoModelStatus } from '@/features/ai/model/auto-model/models';
import { getClassifierModelId } from '@/features/ai/model/opencode-auto-model';
import { getVisibleModels } from '@/features/ai/model/opencode-model-selection';
import type { CapabilitiesContextValue, ProviderOption } from '../model/types';
import { CLASSIFIER_QUERY_META, classifierProbeKey, createClassifierCommands, type ClassifierResult } from '../services/classifier-commands';

export type ModelRoutingInput = {
  identity: QueryIdentity;
  scopeKey: string;
  revision?: number;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  availableProviders: ProviderOption[];
  availableModels: ModelOption[];
  chatPreferences: ChatPreferences;
};

export function useModelRouting({
  identity, scopeKey, revision, client, isCurrentClient, availableProviders, availableModels, chatPreferences,
}: ModelRoutingInput, probeAutomatically = false): CapabilitiesContextValue['modelRouting'] {
  const { queryClient: cache, store } = useAppCore();
  const owner = JSON.stringify([revision ?? 0, ...projectQueryKey(identity, client, 'classifier-probe')]);
  const saved = useAppStore((state) => state.workspaceUi[scopeKey]?.classifierProbe);
  const probe = saved?.owner === owner ? saved : undefined;
  const localReady = useAppStore((state) => state.localClassifierReady);
  const { data: result } = useQuery<ClassifierResult>({
    queryKey: classifierProbeKey(identity, client, probe?.model), queryFn: skipToken, meta: CLASSIFIER_QUERY_META,
  });
  const visibleModels = useMemo(
    () => getVisibleModels(availableModels, availableProviders.filter((provider) => provider.configured), chatPreferences.enabledModelIds),
    [availableModels, availableProviders, chatPreferences.enabledModelIds],
  );
  const autoModel = chatPreferences.autoModel;
  const defaultModelId = getClassifierModelId(autoModel, visibleModels);
  const commands = useMemo(() => createClassifierCommands({
    cache, store, client, identity, scopeKey, owner, visibleModels, defaultModelId, isCurrentClient,
  }), [cache, client, defaultModelId, identity, isCurrentClient, owner, scopeKey, store, visibleModels]);
  const refreshAvailability = useCallback(() => {
    store.getState().setLocalClassifierReady(getLocalAutoModelStatus() === 'ready');
  }, [store]);
  useLayoutEffect(() => {
    if (store.getState().localClassifierReady === undefined) refreshAvailability();
  }, [refreshAvailability, store]);
  const attempted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!probeAutomatically || !autoModel.enabled || autoModel.classifier !== 'server' || client.__opencode.contract !== 'v2' || !defaultModelId || !isCurrentClient(client)) return;
    const key = JSON.stringify([owner, defaultModelId]);
    if (attempted.current === key) return;
    attempted.current = key;
    void commands.checkServerClassifier(defaultModelId);
  }, [autoModel.classifier, autoModel.enabled, client, commands, defaultModelId, isCurrentClient, owner, probeAutomatically]);
  const serverStatus = probe?.status ?? result?.status ?? 'unknown';
  return useMemo(() => ({ ...commands, refreshAvailability, serverStatus,
    available: autoModel.classifier === 'local' ? localReady === true : serverStatus === 'available',
  }), [autoModel.classifier, commands, localReady, refreshAvailability, serverStatus]);
}
