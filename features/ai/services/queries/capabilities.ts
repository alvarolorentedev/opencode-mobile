import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { discoverProviderCapabilities } from '@/features/ai/services/capabilities-service';

import { queryOptions } from '@tanstack/react-query';

import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function capabilitiesOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'capabilities'),
    queryFn: ({ signal }) => discoverProviderCapabilities(withReadSignal(client, signal)) });
}
