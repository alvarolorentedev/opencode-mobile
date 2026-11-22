import type { QueryClient } from '@tanstack/react-query';

import type { AppCore } from '@/runtime/core';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

import { CLASSIFIER_PROBE_STALE_MS, probeServerClassifier, type ServerClassifierStatus } from '@/features/ai/services/model-routing-service';

export const CLASSIFIER_QUERY_META = { retainOnCredentialRenewal: false };
export type ClassifierResult = Awaited<ReturnType<typeof probeServerClassifier>>;

export function classifierProbeKey(identity: QueryIdentity, client: ScopedOpencodeClient, model?: { providerId: string; modelId: string }) {
  return projectQueryKey(identity, client, 'classifier-probe', model?.providerId, model?.modelId);
}

export function createClassifierCommands({
  cache, store, client, identity, scopeKey, owner, visibleModels, defaultModelId, isCurrentClient,
}: {
  cache: QueryClient;
  store: Pick<AppCore['store'], 'getState'>;
  client: ScopedOpencodeClient;
  identity: QueryIdentity;
  scopeKey: string;
  owner: string;
  visibleModels: ModelOption[];
  defaultModelId?: string;
  isCurrentClient: (candidate: object) => boolean;
}) {
  const read = () => store.getState().workspaceUi[scopeKey]?.classifierProbe;
  const isCurrent = () => isCurrentClient(client);
  const write = (classifierProbe: ReturnType<typeof read>) => store.getState().setWorkspaceUi(scopeKey, { classifierProbe });

  async function checkServerClassifier(modelId = defaultModelId): Promise<ServerClassifierStatus> {
    if (!isCurrent()) return 'unavailable';
    const model = modelId ? visibleModels.find((item) => item.id === modelId) : undefined;
    if (!model) {
      write({ owner, status: 'unavailable' });
      return 'unavailable';
    }
    if (client.__opencode.contract !== 'v2' || !client.api?.generate) {
      write({ owner, status: 'unsupported' });
      return 'unsupported';
    }

    const selection = { providerId: model.providerID, modelId: model.modelID };
    const request = Symbol();
    write({ owner, request, model: selection, status: 'checking' });
    const ownsRequest = () => isCurrent() && read()?.request === request;
    try {
      const result = await cache.fetchQuery<ClassifierResult>({
        queryKey: classifierProbeKey(identity, client, selection),
        queryFn: () => probeServerClassifier({ client, modelID: model.modelID, providerID: model.providerID }),
        staleTime: (query) => query.state.data?.cacheable ? CLASSIFIER_PROBE_STALE_MS : 0,
        networkMode: 'always', meta: CLASSIFIER_QUERY_META,
      });
      if (!ownsRequest()) return 'unavailable';
      write({ owner, model: selection });
      return result.status;
    } catch {
      if (ownsRequest()) write({ owner, status: 'unavailable' });
      return 'unavailable';
    }
  }

  function resetServerClassifier() {
    if (isCurrent() && read()?.owner === owner) write(undefined);
  }

  return { checkServerClassifier, resetServerClassifier };
}
