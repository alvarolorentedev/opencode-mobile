// Client construction and the V1/V2 contract boundary.
// See docs/architecture/api-contract.md.
import { buildV1Compatibility } from './compat/v1/client';

import { buildV2Client } from './v2-client';
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
  ScopedOpencodeClient,
  ProviderAccountInfo,
} from './client/types';
export { defaultConnectionSettings } from './client/types';
export {
  getNormalizedServerUrl,
  isValidServerUrl,
  getServerBase,
} from './client/url';
export { getRequestHeaders, createPrefixFetch } from './client/fetch';
export {
  DEFAULT_SERVICES_PORT,
  MAX_MANAGED_SERVICES,
  buildServiceShareUrl,
  formatServiceAddress,
  getServicePortOptions,
  prepareServiceDraft,
  type ManagedService,
  type ServiceDraft,
  type ServiceDraftErrors,
  type ServiceInput,
  type ServiceManagementVersion,
  type ServicePortOption,
} from './client/management';
export {
  ServiceManagementError,
  deleteManagedService,
  getServiceManagementVersion,
  listManagedServices,
  putManagedService,
} from './client/management-api';
export { getConnectionError, isContractMismatchError, isRetryableCloudLinkStartupError, classifyConnectionFailure, isAuthConnectionFailure, type ConnectionFailureKind } from './client/errors';
export { detectServerContract, type ConnectionProbeResult } from './client/probe';
export {
  listPendingInteractions,
  replyToPendingPermission,
  replyToPendingQuestion,
  rejectPendingQuestion,
  listSavedPermissionRules,
  removeSavedPermissionRule,
} from './client/interactions';

const readFactories = new WeakMap<ScopedOpencodeClient, (signal: AbortSignal) => ScopedOpencodeClient>();
export function buildClient(settings: OpencodeConnectionSettings, contract: ServerContract = 'v2', signal?: AbortSignal, lifetimeSignal?: AbortSignal): ScopedOpencodeClient {
  const client = contract === 'v2' ? buildV2Client(settings, signal, lifetimeSignal)
    : { compatibility: buildV1Compatibility(settings, signal, lifetimeSignal), __opencode: { contract, directory: settings.directory.trim() || undefined } };
  readFactories.set(client, (readSignal) => buildClient(settings, contract, readSignal, lifetimeSignal ?? signal));
  return client;
}
export function withReadSignal(client: ScopedOpencodeClient, signal: AbortSignal): ScopedOpencodeClient {
  return readFactories.get(client)?.(signal) ?? client;
}

export function buildPtyWebSocketUrl(
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>,
  ptyId: string,
  options?: { ticket?: string; cursor?: string },
  contract: ServerContract = 'v2',
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
