import { base64 } from '@scure/base';
import { fetch as expoFetch } from 'expo/fetch';

import { recordBytes, recordRequest } from '@/shared/network/data-usage';
import { recordRequestStart } from '@/shared/network/request-stats';
import { telemetry } from '@/shared/observability/client';
import { getConnectCredentialError } from '@/shared/contracts/cloud-link';
import { classifyConnectionFailure } from '@/shared/protocol/opencode/client/errors';
import { classifyHttpOperation } from '@/shared/protocol/opencode/client/operation';
import { joinUrlPath } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import { fetchWithReadDeadline } from '@/shared/protocol/opencode/client/read-deadline';
import { getRequestTimeout, shouldRetryRead } from '@/shared/protocol/opencode/client/request-policy';
import { ensureConnectionTrust } from '@/shared/platform/tls-trust';

export function createAuthHeader(settings: OpencodeConnectionSettings) {
  const password = settings.password;
  if (!password) {
    return undefined;
  }

  const username = settings.username.trim() || 'opencode';
  return `Basic ${base64.encode(new TextEncoder().encode(`${username}:${password}`))}`;
}

export function getRequestHeaders(settings: OpencodeConnectionSettings) {
  const authHeader = createAuthHeader(settings);
  // Custom gateway headers apply to every request for this connection. Basic
  // auth is generated last: `authorization` is rejected by header validation, so
  // this only guarantees the app-owned value always wins.
  const headers = {
    ...(settings.headers ?? {}),
    ...(authHeader ? { Authorization: authHeader } : {}),
  };
  return Object.keys(headers).length ? headers : undefined;
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('OpenCode read canceled.'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('OpenCode read canceled.'));
    }, { once: true });
  });
}

async function performFetch(
  transport: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  settings: OpencodeConnectionSettings | undefined,
  timeoutMs: number | undefined,
  lifetimeSignal?: AbortSignal,
) {
  const response = timeoutMs
    ? await fetchWithReadDeadline(transport, input, init, timeoutMs, lifetimeSignal)
    : await transport(input, init);
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

export async function fetchConnection(input: RequestInfo | URL, init?: RequestInit, settings?: OpencodeConnectionSettings, lifetimeSignal?: AbortSignal) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const operation = classifyHttpOperation(url, method);
  const activeSpan = telemetry.startSpan('http.request', { operation, method });
  const startedAt = Date.now();
  try {
    const response = await fetchConnectionInner(input, init, settings, lifetimeSignal);
    const durationMs = Math.max(0, Date.now() - startedAt);
    telemetry.histogram('http.request.duration', durationMs, 'ms', { operation });
    telemetry.counter('http.request.count', 1, { operation, outcome: 'success' });
    activeSpan.end('ok');
    return response;
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const cancelled = /cancel/i.test(error instanceof Error ? error.message : String(error));
    const outcome = cancelled ? 'cancelled' : 'failure';
    telemetry.histogram('http.request.duration', durationMs, 'ms', { operation });
    telemetry.counter('http.request.count', 1, { operation, outcome });
    if (!cancelled) {
      telemetry.logWithSpan(activeSpan, 'warn', 'http.request.failed', {
        operation,
        failureKind: classifyConnectionFailure(error),
      });
    }
    activeSpan.end(cancelled ? 'cancelled' : 'error');
    throw error;
  }
}

async function fetchConnectionInner(input: RequestInfo | URL, init?: RequestInit, settings?: OpencodeConnectionSettings, lifetimeSignal?: AbortSignal) {
  const retryUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const retryMethod = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const operation = classifyHttpOperation(retryUrl, retryMethod);
  if (settings?.connect) {
    const error = getConnectCredentialError(settings.connect, settings.password);
    if (error) throw new Error(error);
  }
  if (settings?.certificate) await ensureConnectionTrust(settings);
  // RN's XHR ignores redirect rejection. Use Expo for Cloud Link and one-use
  // local pairing requests; other manual connections retain their transport.
  const transport = settings?.connect || init?.redirect === 'error'
    ? (input: RequestInfo | URL, init?: RequestInit) => expoFetch(input, { ...init, redirect: 'error' })
    : fetch;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const signal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
  const timeoutMs = getRequestTimeout(url, method);
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt += 1) {
    if (lifetimeSignal?.aborted) throw new Error('OpenCode read canceled.');
    const finishStats = recordRequestStart();
    try {
      const response = await performFetch(transport, input, init, settings, timeoutMs, lifetimeSignal);
      if (shouldRetryRead({ method, url, attempt, elapsedMs: Date.now() - startedAt, status: response.status })) {
        telemetry.counter('http.retry', 1, { operation });
        finishStats({ status: response.status, retried: true });
        // Drain tiny retryable gateway errors so the connection can be reused,
        // but never consume a successful body.
        await response.body?.cancel().catch(() => undefined);
        await abortableDelay(250 + Math.round(Math.random() * 250), signal);
        continue;
      }
      finishStats({ status: response.status });
      return response;
    } catch (error) {
      finishStats({ error });
      if (!shouldRetryRead({ method, url, attempt, elapsedMs: Date.now() - startedAt, error })) throw error;
      telemetry.counter('http.retry', 1, { operation });
      await abortableDelay(250 + Math.round(Math.random() * 250), signal);
    }
  }
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

export function createScopedFetch(baseUrl: string, pathPrefix: string, directory?: string, settings?: OpencodeConnectionSettings, readSignal?: AbortSignal, lifetimeSignal?: AbortSignal) {
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
      return fetchConnection(parsed.toString(), readSignal ? { ...init, signal: readSignal } : init, settings, lifetimeSignal);
    }

    return fetchConnection(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
      ...init,
      ...(readSignal ? { signal: readSignal } : {}),
    }, settings, lifetimeSignal);
  };
}

export function createPrefixFetch(origin: string, pathPrefix: string, settings?: OpencodeConnectionSettings, readSignal?: AbortSignal, lifetimeSignal?: AbortSignal) {
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
      return fetchConnection(parsed.toString(), readSignal ? { ...init, signal: readSignal } : init, settings, lifetimeSignal);
    }

    return fetchConnection(parsed.toString(), {
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text(),
      credentials: input.credentials,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
      ...init,
      ...(readSignal ? { signal: readSignal } : {}),
    }, settings, lifetimeSignal);
  };
}
