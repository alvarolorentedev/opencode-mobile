import {
  createOpencodeClient,
  type OpencodeClient,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionRequest,
} from '@opencode-ai/sdk/v2/client';
import { encode as encodeBase64 } from 'base-64';
import Constants from 'expo-constants';

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

function joinUrlPath(prefix: string, pathname: string) {
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

  if (/404|not found/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
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

function getRequestHeaders(settings: OpencodeConnectionSettings) {
  const authHeader = createAuthHeader(settings);
  return authHeader
    ? {
        Authorization: authHeader,
      }
    : undefined;
}

export function buildClient(settings: OpencodeConnectionSettings): ScopedOpencodeClient {
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
) {
  const server = normalizeServerUrl(settings.serverUrl);
  if (!server.valid) {
    throw new Error('Cannot build a terminal URL from an invalid server URL.');
  }

  const url = new URL(server.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = joinUrlPath(server.pathPrefix, `/pty/${encodeURIComponent(ptyId)}/connect`);
  const directory = settings.directory.trim();
  if (directory) url.searchParams.set('directory', directory);
  if (options?.ticket) url.searchParams.set('ticket', options.ticket);
  if (options?.cursor) url.searchParams.set('cursor', options.cursor);
  return url.toString();
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
