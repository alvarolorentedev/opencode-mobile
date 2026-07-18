import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/client';
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from '@opencode-ai/sdk/v2/types';
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
};

type ServerBase = {
  baseUrl: string;
  pathPrefix: string;
};

type ClientMetadata = {
  baseUrl: string;
  directory?: string;
  headers?: Record<string, string>;
  displayUrl: string;
  pathPrefix: string;
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
  const parsed = new URL(withProtocol);
  const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  const displayUrl = `${parsed.origin}${pathPrefix}`;

  return {
    displayUrl,
    origin: parsed.origin,
    pathPrefix,
  };
}

function buildServerUrl(pathname: string, settingsOrBase: OpencodeConnectionSettings | ServerBase) {
  const base = 'serverUrl' in settingsOrBase
    ? (() => {
        const normalized = normalizeServerUrl(settingsOrBase.serverUrl);
        return {
          baseUrl: normalized.origin,
          pathPrefix: normalized.pathPrefix,
        };
      })()
    : settingsOrBase;
  return `${base.baseUrl}${joinUrlPath(base.pathPrefix, pathname)}`;
}

function createScopedFetch(baseUrl: string, pathPrefix: string) {
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

    if (typeof input === 'string' || input instanceof URL) {
      return fetch(parsed.toString(), init);
    }

    return fetch(new Request(parsed.toString(), input), init);
  };
}

function getConnectionErrorMessage(error: unknown, serverUrl: string) {
  if (!(error instanceof Error)) {
    return 'Something went wrong while talking to OpenCode.';
  }

  const normalizedUrl = normalizeServerUrl(serverUrl).displayUrl;
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

  const client = createOpencodeClient({
    baseUrl: normalizedServerUrl.origin,
    directory,
    fetch: createScopedFetch(normalizedServerUrl.origin, normalizedServerUrl.pathPrefix),
    headers,
    responseStyle: 'fields',
    throwOnError: true,
  }) as ScopedOpencodeClient;

  client.__opencode = {
    baseUrl: normalizedServerUrl.origin,
    directory,
    headers,
    displayUrl: normalizedServerUrl.displayUrl,
    pathPrefix: normalizedServerUrl.pathPrefix,
  };

  return client;
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).displayUrl;
}

export function getConnectionError(serverUrl: string, error: unknown) {
  return getConnectionErrorMessage(error, serverUrl);
}

export async function requestOpenCodeApi<T>(client: ScopedOpencodeClient, path: string, init?: RequestInit): Promise<T> {
  const baseUrl = client.__opencode.baseUrl;
  if (!baseUrl) {
    throw new Error('OpenCode client is missing base URL metadata.');
  }

  const requestUrl = new URL(buildServerUrl(path, {
    baseUrl,
    pathPrefix: client.__opencode.pathPrefix,
  }));
  const directory = client.__opencode.directory;
  if (directory && !requestUrl.searchParams.has('directory')) {
    requestUrl.searchParams.set('directory', directory);
  }

  const response = await fetch(requestUrl.toString(), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(client.__opencode.headers || {}),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`OpenCode request failed: ${response.status}${detail ? ` - ${detail.slice(0, 1000)}` : ''}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function listPendingInteractions(client: ScopedOpencodeClient) {
  const [permissions, questions] = await Promise.all([
    requestOpenCodeApi<PendingPermissionRequest[]>(client, '/permission'),
    requestOpenCodeApi<PendingQuestionRequest[]>(client, '/question'),
  ]);

  return { permissions, questions };
}

export async function replyToPendingPermission(
  client: ScopedOpencodeClient,
  permissionId: string,
  reply: 'once' | 'always' | 'reject',
) {
  await requestOpenCodeApi(client, `/permission/${encodeURIComponent(permissionId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ reply }),
  });
}

export async function replyToPendingQuestion(client: ScopedOpencodeClient, requestId: string, answers: PendingQuestionAnswer[]) {
  await requestOpenCodeApi(client, `/question/${encodeURIComponent(requestId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export async function rejectPendingQuestion(client: ScopedOpencodeClient, requestId: string) {
  await requestOpenCodeApi(client, `/question/${encodeURIComponent(requestId)}/reject`, { method: 'POST' });
}
