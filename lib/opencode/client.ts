import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';

import { buildV2Client } from './v2-client';
import { createScopedFetch, getRequestHeaders } from './client/fetch';
import { joinUrlPath, normalizeServerUrl } from './client/url';
import type { OpencodeConnectionSettings, ScopedOpencodeClient, ServerContract } from './client/types';

export type {
  ServerContract,
  PendingPermissionRequest,
  PendingPermission,
  PendingQuestionPrompt,
  PendingQuestionRequest,
  PendingQuestion,
  PendingQuestionAnswer,
  SavedPermissionRule,
  OpencodeConnectionSettings,
  NormalizedServerUrl,
  ClientMetadata,
  ScopedOpencodeClient,
  ProviderAccountInfo,
  ProviderAccountsApi,
  ProviderOAuthApi,
} from './client/types';
export { defaultConnectionSettings } from './client/types';
export {
  joinUrlPath,
  normalizeServerUrl,
  getNormalizedServerUrl,
  isValidServerUrl,
  getServerBase,
} from './client/url';
export { createAuthHeader, getRequestHeaders, createScopedFetch, createPrefixFetch, fetchConnection } from './client/fetch';
export { getConnectionError, getConnectionErrorMessage, isContractMismatchError } from './client/errors';
export { detectServerContract, probeConnection, type ContractProbeResult, type ConnectionProbeResult } from './client/probe';
export {
  listPendingInteractions,
  replyToPendingPermission,
  replyToPendingQuestion,
  rejectPendingQuestion,
  listSavedPermissionRules,
  removeSavedPermissionRule,
} from './client/interactions';

export function buildClient(settings: OpencodeConnectionSettings, contract: ServerContract = 'v1'): ScopedOpencodeClient {
  if (contract === 'v2') {
    return buildV2Client(settings);
  }

  const normalizedServerUrl = normalizeServerUrl(settings.serverUrl);
  const headers = getRequestHeaders(settings);
  const directory = settings.directory.trim() || undefined;

  return Object.assign(
    createOpencodeClient({
      baseUrl: normalizedServerUrl.origin,
      fetch: createScopedFetch(normalizedServerUrl.origin, normalizedServerUrl.pathPrefix, directory, settings),
      headers,
      responseStyle: 'fields',
      throwOnError: true,
    }),
    { __opencode: { directory } },
  );
}

export function buildPtyWebSocketUrl(
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>,
  ptyId: string,
  options?: { ticket?: string; cursor?: string },
  contract: ServerContract = 'v1',
) {
  const server = normalizeServerUrl(settings.serverUrl);
  if (!server.valid) {
    throw new Error('Cannot build a terminal URL from an invalid server URL.');
  }

  const url = new URL(server.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const directory = settings.directory.trim();

  if (contract === 'v2') {
    // V2 bakes /api into its routes and scopes WebSockets with location[directory].
    const prefix = server.pathPrefix.replace(/\/api$/, '');
    url.pathname = joinUrlPath(prefix, `/api/pty/${encodeURIComponent(ptyId)}/connect`);
    if (directory) url.searchParams.set('location[directory]', directory);
  } else {
    url.pathname = joinUrlPath(server.pathPrefix, `/pty/${encodeURIComponent(ptyId)}/connect`);
    if (directory) url.searchParams.set('directory', directory);
  }

  if (options?.ticket) url.searchParams.set('ticket', options.ticket);
  if (options?.cursor) url.searchParams.set('cursor', options.cursor);
  return url.toString();
}
