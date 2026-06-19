import { createOpencodeClient } from '@opencode-ai/sdk/client';
import { encode as encodeBase64 } from 'base-64';
import Constants from 'expo-constants';

// Small exported shapes used by the UI for pending requests.
export type PendingPermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
};

export type QuestionOption = { label: string; description?: string };
export type PendingQuestionRequest = {
  id: string;
  sessionID: string;
  questions: Array<{ question: string; header: string; options: QuestionOption[]; multiple?: boolean; custom?: boolean }>;
  tool?: { messageID: string; callID: string };
};

export type PendingQuestionAnswer = string[];

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
  bellowsServerUrl?: string;
  bellowsApiKey?: string;
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
  bellowsServerUrl: 'http://127.0.0.1:4000',
  bellowsApiKey: 'sk-anvil-safe-key',
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
    return 'Something went wrong while talking to Bellows.';
  }

  const normalizedUrl = normalizeServerUrl(serverUrl).displayUrl;
  const message = error.message || 'Something went wrong while talking to Bellows.';

  if (/404|not found/i.test(message)) {
    return `Bellows endpoint not found at ${normalizedUrl}. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return a Bellows API response. If this address serves a web UI, use the API base URL instead, usually ${normalizedUrl}/api.`;
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

export function buildClient(settings: OpencodeConnectionSettings): any {
  const normalizedServerUrl = normalizeServerUrl(settings.serverUrl);
  const headers = getRequestHeaders(settings);
  const directory = settings.directory.trim() || undefined;

  // return a runtime client; type is kept as `any` to avoid coupling to generated SDK types
  const client = createOpencodeClient({
    baseUrl: normalizedServerUrl.origin,
    directory,
    fetch: createScopedFetch(normalizedServerUrl.origin, normalizedServerUrl.pathPrefix),
    headers,
  }) as any;

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

async function apiRequest(client: any, path: string, init?: RequestInit) {
  const baseUrl = client?.__opencode?.baseUrl;
  if (!baseUrl) {
    throw new Error('Bellows client is missing base URL metadata.');
  }

  const requestUrl = new URL(buildServerUrl(path, {
    baseUrl,
    pathPrefix: client?.__opencode?.pathPrefix || '',
  }));
  const directory = client?.__opencode?.directory;
  if (directory && !requestUrl.searchParams.has('directory')) {
    requestUrl.searchParams.set('directory', directory);
  }

  const response = await fetch(requestUrl.toString(), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(client?.__opencode?.headers || {}),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Bellows request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}

export async function listPendingPermissions(client: any): Promise<PendingPermissionRequest[]> {
  const response = await apiRequest(client, '/permission');
  return (response?.data ?? response ?? []) as PendingPermissionRequest[];
}

export async function listPendingQuestions(client: any): Promise<PendingQuestionRequest[]> {
  const response = await apiRequest(client, '/question');
  return (response?.data ?? response ?? []) as PendingQuestionRequest[];
}

export async function replyToPendingPermission(
  client: any,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  message?: string,
) {
  await apiRequest(client, `/permission/${requestId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ reply, message }),
  });
}

export async function replyToPendingQuestion(client: any, requestId: string, answers: PendingQuestionAnswer[]) {
  await apiRequest(client, `/question/${requestId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export async function rejectPendingQuestion(client: any, requestId: string) {
  await apiRequest(client, `/question/${requestId}/reject`, {
    method: 'POST',
  });
}

export async function setSessionArchived(client: any, sessionId: string, archivedAt?: number) {
  await apiRequest(client, `/session/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      time: {
        archived: archivedAt ?? null,
      },
    }),
  });
}
