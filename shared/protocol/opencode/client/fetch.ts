import { fetch as expoFetch } from 'expo/fetch';

import { recordBytes, recordRequest } from '@/shared/network/data-usage';
import { recordRequestStart } from '@/shared/network/request-stats';
import { telemetry } from '@/shared/observability/client';
import { getConnectCredentialError } from '@/shared/contracts/cloud-link';
import { assertOidcRequestTarget, resolveAuthorizedHeaders, refreshOidcAuthorization } from '@/shared/protocol/opencode/client/authorization';
import { classifyConnectionFailure } from '@/shared/protocol/opencode/client/errors';
import { classifyHttpOperation } from '@/shared/protocol/opencode/client/operation';
import { oidcTokenHeader } from '@/shared/contracts/connection-oidc';
import { joinUrlPath } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';
import { fetchWithReadDeadline } from '@/shared/protocol/opencode/client/read-deadline';
import { getRequestTimeout, shouldRetryRead } from '@/shared/protocol/opencode/client/request-policy';
import { ensureConnectionTrust } from '@/shared/platform/tls-trust';

// Re-exported for existing importers; the implementation lives with the other
// credential rules so OpenID Connect and basic auth cannot diverge.
export { createAuthHeader, getRequestHeaders, withOidcAuthorization } from '@/shared/protocol/opencode/client/authorization';

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
  try {
    return await fetchConnectionInner(input, init, settings, lifetimeSignal);
  } catch (error) {
    const cancelled = /cancel/i.test(error instanceof Error ? error.message : String(error));
    if (!cancelled) {
      telemetry.warn('http.request.failed', {
        operation,
        failureKind: classifyConnectionFailure(error),
      });
    }
    throw error;
  }
}

async function fetchConnectionInner(input: RequestInfo | URL, init?: RequestInit, settings?: OpencodeConnectionSettings, lifetimeSignal?: AbortSignal) {
  const retryUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (settings?.connect) {
    const error = getConnectCredentialError(settings.connect, settings.password);
    if (error) throw new Error(error);
  }
  if (settings?.oidc) assertOidcRequestTarget(settings, retryUrl);
  if (settings?.certificate || settings?.oidc) await ensureConnectionTrust(settings);
  // RN's XHR ignores redirect rejection. Expo enforces it for OIDC,
  // Cloud Link and one-use pairing; legacy manual transports stay unchanged.
  const transport = settings?.connect || settings?.oidc || init?.redirect === 'error'
    ? (input: RequestInfo | URL, init?: RequestInit) => expoFetch(input, { ...init, redirect: 'error' })
    : fetch;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const signal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
  const timeoutMs = getRequestTimeout(url, method);
  const startedAt = Date.now();
  // Only a request without a body, or with a string body, can be replayed after
  // a token refresh. Streams and FormData have already been consumed; a Request
  // object also carries its own body, so it is only replayable when it is a
  // read.
  const inputMethod = typeof input === 'object' && 'method' in input ? input.method : undefined;
  const replayableBody = (init?.body === undefined || init?.body === null || typeof init.body === 'string')
    && (!inputMethod || /^(GET|HEAD)$/i.test(inputMethod) || typeof init?.body === 'string');
  const inputHeaders = init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined);
  let requestInit: RequestInit | undefined = settings?.oidc
    ? { ...init, headers: await resolveAuthorizedHeaders(settings, inputHeaders) }
    : init;
  let reauthorized = false;

  for (let attempt = 0; ; attempt += 1) {
    if (lifetimeSignal?.aborted) throw new Error('OpenCode read canceled.');
    const finishStats = recordRequestStart();
    try {
      const response = await performFetch(transport, input, requestInit, settings, timeoutMs, lifetimeSignal);
      // An expired or revoked access token is renewed once. A dead refresh
      // token throws the sign-in-required error, which stops automatic retries
      // and surfaces the "Sign in again" action.
      if (settings?.oidc && !reauthorized && (response.status === 401 || response.status === 403)) {
        reauthorized = true;
        await refreshOidcAuthorization(settings, new Headers(requestInit?.headers).get(oidcTokenHeader(settings.oidc)) ?? undefined);
        if (!replayableBody) {
          finishStats({ status: response.status });
          return response;
        }
        await response.body?.cancel().catch(() => undefined);
        requestInit = { ...init, headers: await resolveAuthorizedHeaders(settings, inputHeaders) };
        finishStats({ status: response.status, retried: true });
        continue;
      }
      if (!reauthorized && shouldRetryRead({ method, url, attempt, elapsedMs: Date.now() - startedAt, status: response.status })) {
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
      if (reauthorized || !shouldRetryRead({ method, url, attempt, elapsedMs: Date.now() - startedAt, error })) throw error;
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
