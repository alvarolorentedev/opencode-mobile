import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { loadHealth } from '@/shared/protocol/services/diagnostics-service';
import { getMcpStatus } from '@/shared/protocol/services/mcp-service';
import { queryOptions } from '@tanstack/react-query';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
export function mcpOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'mcp'), staleTime: 0,
    queryFn: ({ signal }) => getMcpStatus(withReadSignal(client, signal)) });
}

export function healthOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'diagnostics'), staleTime: 0,
    queryFn: ({ signal }) => loadHealth(withReadSignal(client, signal)) });
}
