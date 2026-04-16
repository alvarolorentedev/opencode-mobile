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
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
};

function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultConnectionSettings.serverUrl;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/$/, '');
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
  const baseUrl = normalizeServerUrl(settings.serverUrl);
  const headers = getRequestHeaders(settings);

  // return a runtime client; type is kept as `any` to avoid coupling to generated SDK types
  const client = createOpencodeClient({
    baseUrl,
    directory: settings.directory.trim() || undefined,
    headers,
  }) as any;

  client.__opencode = {
    baseUrl,
    directory: settings.directory.trim() || undefined,
    headers,
  };

  return client;
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl);
}

async function apiRequest(client: any, path: string, init?: RequestInit) {
  const baseUrl = client?.__opencode?.baseUrl;
  if (!baseUrl) {
    throw new Error('OpenCode client is missing base URL metadata.');
  }

  const requestUrl = new URL(`${baseUrl}${path}`);
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
    throw new Error(`OpenCode request failed: ${response.status}`);
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
