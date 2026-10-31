import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { createScopedFetch, getRequestHeaders } from '@/shared/protocol/opencode/client/fetch';
import { normalizeServerUrl } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
export type LegacyClient = OpencodeClient;
export function buildV1Compatibility(settings: OpencodeConnectionSettings, signal?: AbortSignal, lifetimeSignal?: AbortSignal): LegacyClient {
  const server = normalizeServerUrl(settings.serverUrl);
  return createOpencodeClient({ baseUrl: server.origin, fetch: createScopedFetch(server.origin, server.pathPrefix, settings.directory.trim() || undefined, settings, signal, lifetimeSignal), headers: getRequestHeaders(settings), responseStyle: 'fields', throwOnError: true });
}
