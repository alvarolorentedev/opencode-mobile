import { encode as encodeBase64 } from 'base-64';
import { fetch as expoFetch } from 'expo/fetch';

import { recordBytes, recordRequest } from '../data-usage';
import { getConnectCredentialError } from '@/lib/connect';
import { joinUrlPath } from './url';
import type { OpencodeConnectionSettings } from './types';
import { fetchWithReadDeadline } from './read-deadline';

export function createAuthHeader(settings: OpencodeConnectionSettings) {
  const password = settings.password;
  if (!password) {
    return undefined;
  }

  const username = settings.username.trim() || 'opencode';
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${encodeBase64(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
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
  const transport = settings?.connect || init?.redirect === 'error'
    ? (input: RequestInfo | URL, init?: RequestInit) => expoFetch(input, { ...init, redirect: 'error' })
    : fetch;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const finiteRead = /^(GET|HEAD)$/i.test(method) && !/\/event\/?(?:\?|$)/.test(url);
  const response = finiteRead ? await fetchWithReadDeadline(transport, input, init) : await transport(input, init);
  recordRequest();
  measureResponseBytes(response);
  if (settings?.connect && response.status === 401) throw new Error('Cloud Link credentials were rejected. Pair this device again.');
  if (settings?.connect && response.status === 403) throw new Error('Cloud Link access was denied (403). Check your subscription or device credentials.');
  // Some SDKs discard HTML error bodies, hiding Cloudflare's tunnel-startup code.
  if (settings?.connect && !response.ok && /text\/(?:html|plain)/i.test(response.headers.get('content-type') ?? '')) {
    const body = await response.clone().text();
    if (/\b1033\b/.test(body)) throw new Error('Cloudflare Error 1033');
  }
  return response;
}

// shortcut: counts advertised body sizes only; add streaming accounting if exact
// network diagnostics become necessary, never buffer a second copy to count it.
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
      ...init,
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
      ...init,
    }, settings);
  };
}
