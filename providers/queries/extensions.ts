import { withReadSignal, type ScopedOpencodeClient } from '@/lib/opencode/client';
import { createServerAdapter } from '@/lib/opencode/contracts/server-adapter';
import { inspectExtensions } from '@/providers/services/extensions-service';
import { queryOptions } from '@tanstack/react-query';
import { configurationOptions } from './catalogs';
import { projectQueryKey, type QueryIdentity } from './keys';
export function pluginsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'plugins'),
    queryFn: ({ signal }) => createServerAdapter(withReadSignal(client, signal)).extensions.plugins() });
}
export function extensionInspectionOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({ queryKey: projectQueryKey(identity, client, 'extension-inspection'), staleTime: 0,
    queryFn: async ({ client: cache, signal }) => {
      let configuration = await cache.fetchQuery(configurationOptions(identity, client));
      if (!configuration.entries) configuration = await cache.fetchQuery({ ...configurationOptions(identity, client), staleTime: 0 });
      if (signal.aborted) throw new Error('OpenCode read canceled.');
      return inspectExtensions(withReadSignal(client, signal), configuration.entries!);
    } });
}
