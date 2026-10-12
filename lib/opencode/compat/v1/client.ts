import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { createScopedFetch, getRequestHeaders } from '../../client/fetch';
import { normalizeServerUrl } from '../../client/url';
import type { OpencodeConnectionSettings } from '../../client/types';
export type LegacyClient = OpencodeClient;
export function buildV1Compatibility(settings: OpencodeConnectionSettings): LegacyClient {
  const server = normalizeServerUrl(settings.serverUrl);
  return createOpencodeClient({ baseUrl: server.origin, fetch: createScopedFetch(server.origin, server.pathPrefix, settings.directory.trim() || undefined, settings), headers: getRequestHeaders(settings), responseStyle: 'fields', throwOnError: true });
}
