import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';
import { inspectExtensions } from '@/features/extensions/services/extensions-service';
import { queryOptions } from '@tanstack/react-query';
import { configurationOptions } from '@/shared/server-data/catalogs';
import { projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';
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
