import { encode as encodeBase64 } from 'base-64';
import { fetch as expoFetch } from 'expo/fetch';

import { recordBytes, recordRequest } from '../data-usage';
import { getConnectCredentialError } from '@/lib/connect';
import { joinUrlPath } from './url';
import type { OpencodeConnectionSettings } from './types';

export function createAuthHeader(settings: OpencodeConnectionSettings) {
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

export async function fetchConnection(input: RequestInfo | URL, init?: RequestInit, settings?: OpencodeConnectionSettings) {
  if (settings?.connect) {
    const error = getConnectCredentialError(settings.connect, settings.password);
    if (error) throw new Error(error);
  }
  // RN's XHR ignores redirect rejection. Use Expo for Cloud Link and one-use
  // local pairing requests; other manual connections retain their transport.
  const response = settings?.connect || init?.redirect === 'error' ? await expoFetch(input, { ...init, redirect: 'error' }) : await fetch(input, init);
  recordRequest();
  measureResponseBytes(response);
  if (settings?.connect && response.status === 401) throw new Error('Cloud Link credentials were rejected. Pair this device again.');
  return response;
}

// Best-effort response size accounting for the data-usage diagnostic. SSE bodies
// are streamed and never end, so they are intentionally not buffered to count.
function measureResponseBytes(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return;
  }
  const lengthHeader = response.headers.get('content-length');
  const length = lengthHeader ? Number(lengthHeader) : NaN;
  if (Number.isFinite(length) && length >= 0) {
    recordBytes(length);
    return;
  }
  try {
    const clone = response.clone();
    void clone.arrayBuffer().then((buffer) => recordBytes(buffer.byteLength)).catch(() => undefined);
  } catch {
    // Body was already consumed or is not cloneable; skip measurement.
  }
}

export function createScopedFetch(baseUrl: string, pathPrefix: string, directory?: string, settings?: OpencodeConnectionSettings) {
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
      return fetchConnection(parsed.toString(), init, settings);
    }

    return fetchConnection(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    }, settings);
  };
}

export function createPrefixFetch(origin: string, pathPrefix: string, settings?: OpencodeConnectionSettings) {
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
      return fetchConnection(parsed.toString(), init, settings);
    }

    return fetchConnection(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
    }, settings);
  };
}
