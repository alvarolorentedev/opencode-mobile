import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/client';
import { encode as encodeBase64 } from 'base-64';

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
};

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: 'http://127.0.0.1:4096',
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

export function buildClient(settings: OpencodeConnectionSettings): OpencodeClient {
  const authHeader = createAuthHeader(settings);

  return createOpencodeClient({
    baseUrl: normalizeServerUrl(settings.serverUrl),
    directory: settings.directory.trim() || undefined,
    headers: authHeader
      ? {
          Authorization: authHeader,
        }
      : undefined,
    throwOnError: true,
  });
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl);
}
