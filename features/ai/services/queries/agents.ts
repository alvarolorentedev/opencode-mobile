import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';

import { toAgentOption } from '@/shared/protocol/opencode/agent-option';

import { queryOptions } from '@tanstack/react-query';

import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export function agentsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'agents'),
    queryFn: async ({ signal }) => (await createServerAdapter(withReadSignal(client, signal)).capabilities.agents() as Parameters<typeof toAgentOption>[0][]).map(toAgentOption) });
}
