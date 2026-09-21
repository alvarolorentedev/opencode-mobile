import {
  createOpencodeClient,
  type OpencodeClient,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionRequest,
} from '@opencode-ai/sdk/v2/client';
import { encode as encodeBase64 } from 'base-64';
import Constants from 'expo-constants';

import { buildV2Client } from './v2-client';

export type ServerContract = 'v1' | 'v2';

export type PendingPermissionRequest = PermissionRequest;
export type PendingQuestionRequest = QuestionRequest;
export type PendingQuestionAnswer = QuestionAnswer;

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
};

type NormalizedServerUrl = {
  displayUrl: string;
  origin: string;
  pathPrefix: string;
  valid: boolean;
};

type ClientMetadata = {
  directory?: string;
};

export type ScopedOpencodeClient = OpencodeClient & {
  __opencode: ClientMetadata;
};

export function joinUrlPath(prefix: string, pathname: string) {
  const normalizedPrefix = prefix === '/' ? '' : prefix.replace(/\/$/, '');
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedPrefix}${normalizedPathname}`;
}

function normalizeServerUrl(value: string): NormalizedServerUrl {
  const trimmed = value.trim();
  if (!trimmed) {
    return normalizeServerUrl(defaultConnectionSettings.serverUrl);
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const displayUrl = `${parsed.origin}${pathPrefix}`;

    return {
      displayUrl,
      origin: parsed.origin,
      pathPrefix,
      valid: Boolean(parsed.hostname),
    };
  } catch {
    return {
      displayUrl: trimmed,
      origin: new URL(defaultConnectionSettings.serverUrl).origin,
      pathPrefix: '',
      valid: false,
    };
  }
}

function createScopedFetch(baseUrl: string, pathPrefix: string, directory?: string) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const currentUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(currentUrl, baseUrl);

    if (parsed.origin === baseUrl && pathPrefix && !parsed.pathname.startsWith(`${pathPrefix}/`) && parsed.pathname !== pathPrefix) {
      parsed.pathname = joinUrlPath(pathPrefix, parsed.pathname);
    }
    if (parsed.origin === baseUrl && directory && !parsed.searchParams.has('directory')) {
      parsed.searchParams.set('directory', directory);
    }

    if (typeof input === 'string' || input instanceof URL) {
      return fetch(parsed.toString(), init);
    }

    return fetch(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    });
  };
}

function getConnectionErrorMessage(error: unknown, serverUrl: string) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.valid) {
    return 'Enter a complete server URL, such as http://192.168.1.10:4096.';
  }

  if (!(error instanceof Error)) {
    return 'Something went wrong while talking to OpenCode.';
  }

  const normalizedUrl = normalized.displayUrl;
  const message = error.message || 'Something went wrong while talking to OpenCode.';
  const alreadyApiBase = /\/api$/i.test(normalizedUrl);
  const apiHint = alreadyApiBase
    ? ''
    : ` If this address serves a web UI, use its API base URL instead, usually ${normalizedUrl}/api.`;
  const versionHint = alreadyApiBase
    ? ' This app supports OpenCode 1.x and 2.x servers; verify the API base URL is correct.'
    : '';

  if (/unsupported.?content.?type|malformed.?response/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  if (/^UnexpectedStatus$/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/text\/html/i.test(message) || /not supported by this version/i.test(message)) {
    return `The server at ${normalizedUrl} returned a web page instead of the OpenCode API.${apiHint}${versionHint}`;
  }

  if (/404|not found/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  return message;
}

function createAuthHeader(settings: OpencodeConnectionSettings) {
  const password = settings.password.trim();
  if (!password) {
    return undefined;
  }

  const username = settings.username.trim() || 'opencode';
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
}

export function getRequestHeaders(settings: OpencodeConnectionSettings) {
  const authHeader = createAuthHeader(settings);
  return authHeader
    ? {
        Authorization: authHeader,
      }
    : undefined;
}

export function getServerBase(serverUrl: string) {
  return normalizeServerUrl(serverUrl);
}

export function createPrefixFetch(origin: string, pathPrefix: string) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const currentUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(currentUrl, origin);

    if (parsed.origin === origin && pathPrefix && !parsed.pathname.startsWith(`${pathPrefix}/`) && parsed.pathname !== pathPrefix) {
      parsed.pathname = joinUrlPath(pathPrefix, parsed.pathname);
    }

    if (typeof input === 'string' || input instanceof URL) {
      return fetch(parsed.toString(), init);
    }

    return fetch(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    });
  };
}

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
      fetch: createScopedFetch(normalizedServerUrl.origin, normalizedServerUrl.pathPrefix, directory),
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

type ContractProbeResult = { contract: ServerContract; version?: string };

async function probeJson(origin: string, pathPrefix: string, path: string, headers?: HeadersInit) {
  const url = `${origin}${joinUrlPath(pathPrefix, path)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      return undefined;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return undefined;
    }
    return (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function detectServerContract(settings: OpencodeConnectionSettings): Promise<ContractProbeResult> {
  const base = normalizeServerUrl(settings.serverUrl);
  if (!base.valid) {
    return { contract: 'v1' };
  }

  const headers = getRequestHeaders(settings);
  // V2 mounts its API under /api; V1 uses unprefixed paths. A configured /api suffix
  // is the API mount itself, not a proxy prefix, so probe from the bare origin.
  const prefixWithoutApi = base.pathPrefix.replace(/\/api$/, '');

  // Run all probes concurrently so an unreachable server costs one timeout, not three.
  const [info, apiHealth, health] = await Promise.all([
    probeJson(base.origin, prefixWithoutApi, '/api/info', headers),
    probeJson(base.origin, prefixWithoutApi, '/api/health', headers),
    probeJson(base.origin, base.pathPrefix, '/global/health', headers),
  ]);

  const v1Health = health && typeof health.version === 'string' && /^1\./.test(health.version) ? health.version : undefined;
  // V2 exposes a ServerInfo at /api/info ({ version, pid, urls, paths }); require that
  // shape so a V1 server's /api compatibility routes are not mistaken for V2.
  const v2Info = info && typeof info.version === 'string' && (typeof info.pid === 'number' || Array.isArray(info.urls) || Boolean(info.paths))
    ? info.version
    : undefined;
  const v2Health = apiHealth && apiHealth.healthy === true ? (typeof apiHealth.version === 'string' ? apiHealth.version : '') : undefined;

  // An explicit 1.x health version is the strongest signal: newer V1 servers also
  // serve some /api routes, and picking V2 there breaks real requests.
  if (v1Health) {
    return { contract: 'v1', version: v1Health };
  }
  if (v2Info !== undefined) {
    return { contract: 'v2', version: v2Info };
  }
  if (v2Health !== undefined && !v1Health) {
    return { contract: 'v2', version: v2Health || undefined };
  }
  if (health && typeof health.version === 'string') {
    return { contract: 'v1', version: health.version };
  }

  // Unknown or unavailable: keep the existing V1 behavior so current messages win.
  return { contract: 'v1' };
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).displayUrl;
}

export function isValidServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).valid;
}

export function getConnectionError(serverUrl: string, error: unknown) {
  return getConnectionErrorMessage(error, serverUrl);
}

export function isContractMismatchError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unsupported.?content.?type|unexpectedstatus|malformed.?response|text\/html|not supported by this version/i.test(error.message);
}

export async function listPendingInteractions(client: ScopedOpencodeClient) {
  const [permissionResponse, questionResponse] = await Promise.all([
    client.permission.list(),
    client.question.list(),
  ]);

  if (!permissionResponse.data || !questionResponse.data) {
    throw new Error('OpenCode did not return pending interactions.');
  }

  return { permissions: permissionResponse.data, questions: questionResponse.data };
}

export async function replyToPendingPermission(
  client: ScopedOpencodeClient,
  requestID: string,
  reply: 'once' | 'always' | 'reject',
) {
  await client.permission.reply({ requestID, reply });
}

export async function replyToPendingQuestion(client: ScopedOpencodeClient, requestID: string, answers: PendingQuestionAnswer[]) {
  await client.question.reply({ requestID, answers });
}

export async function rejectPendingQuestion(client: ScopedOpencodeClient, requestID: string) {
  await client.question.reject({ requestID });
}
