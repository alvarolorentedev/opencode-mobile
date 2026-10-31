import { withReadSignal, type ScopedOpencodeClient } from '@/lib/opencode/client';
import { loadHealth } from '@/providers/services/diagnostics-service';
import { getMcpStatus } from '@/providers/services/mcp-service';
import { queryOptions } from '@tanstack/react-query';
import { projectQueryKey, type QueryIdentity } from './keys';
export function mcpOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'mcp'), staleTime: 0,
    queryFn: ({ signal }) => getMcpStatus(withReadSignal(client, signal)) });
}

export function healthOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'diagnostics'), staleTime: 0,
    queryFn: ({ signal }) => loadHealth(withReadSignal(client, signal)) });
}
