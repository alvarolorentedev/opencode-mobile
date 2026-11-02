import { fetchConnection, getRequestHeaders } from '@/shared/protocol/opencode/client/fetch';
import { joinUrlPath, normalizeServerUrl } from '@/shared/contracts/server-url';
import type { CertificateFailureReason } from '@/shared/contracts/connection-certificate';
import { isCertificateFailureReason, isTlsTrustSupported, probeConnectionTrust, withTemporaryTrust } from '@/shared/platform/tls-trust';
import type { OpencodeConnectionSettings, ServerContract } from '@/shared/protocol/opencode/client/types';

export type ContractProbeResult = { contract: ServerContract; version?: string };
export type ConnectionProbeResult =
  | ({ status: 'detected' } & ContractProbeResult)
  | { status: 'certificate'; reason: CertificateFailureReason }
  | { status: 'authentication-required' | 'openid-sign-in-required' | 'unreachable' | 'unknown' };

async function probeJson(origin: string, pathPrefix: string, path: string, settings: OpencodeConnectionSettings, signal?: AbortSignal) {
  const url = `${origin}${joinUrlPath(pathPrefix, path)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetchConnection(url, { headers: getRequestHeaders(settings), signal: controller.signal }, settings);
    if (!response.ok) {
      return { status: response.status };
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return { status: response.status };
    }
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body: body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function probeV2(settings: OpencodeConnectionSettings, signal?: AbortSignal): Promise<ConnectionProbeResult> {
  const base = normalizeServerUrl(settings.serverUrl);
  if (!base.valid) {
    return { status: 'unknown' };
  }

  // V2 mounts its API under /api; V1 uses unprefixed paths. A configured /api suffix
  // is the API mount itself, not a proxy prefix, so probe from the bare origin.
  const prefixWithoutApi = base.pathPrefix.replace(/\/api$/, '');

  // Run all probes concurrently so an unreachable server costs one timeout, not three.
  const responses = await Promise.all([
    probeJson(base.origin, prefixWithoutApi, '/api/info', settings, signal),
    probeJson(base.origin, prefixWithoutApi, '/api/health', settings, signal),
    probeJson(base.origin, base.pathPrefix, '/global/health', settings, signal),
  ]);
  const [info, apiHealth, health] = responses.map((response) => response?.body);

  const v1Health = [health, apiHealth, info].find((body) => typeof body?.version === 'string' && /^1\./.test(body.version))?.version as string | undefined;
  // V2 exposes a ServerInfo at /api/info ({ version, pid, urls, paths }); require that
  // shape so a V1 server's /api compatibility routes are not mistaken for V2.
  const v2Info = info && typeof info.version === 'string' && (typeof info.pid === 'number' || Array.isArray(info.urls) || Boolean(info.paths))
    ? info.version
    : undefined;
  const v2Health = apiHealth && apiHealth.healthy === true ? (typeof apiHealth.version === 'string' ? apiHealth.version : '') : undefined;

  // An explicit 1.x health version is the strongest signal: newer V1 servers also
  // serve some /api routes, and picking V2 there breaks real requests.
  if (v1Health) {
    return { status: 'detected', contract: 'v1', version: v1Health };
  }
  if (v2Info !== undefined) {
    return { status: 'detected', contract: 'v2', version: v2Info };
  }
  if (v2Health !== undefined && !v1Health) {
    return { status: 'detected', contract: 'v2', version: v2Health || undefined };
  }
  if (health && typeof health.version === 'string') {
    return { status: 'detected', contract: 'v1', version: health.version };
  }

  if (responses.some((response) => response?.status === 401 || response?.status === 403)) return { status: 'authentication-required' };

  // RN's global fetch collapses TLS failures into a generic network error. When
  // the HTTP probe cannot reach an HTTPS server, ask the native trust layer
  // whether the certificate, rather than the network, is the problem.
  if (base.origin.startsWith('https:') && isTlsTrustSupported()) {
    const tls = await probeConnectionTrust(settings);
    if (!tls.ok && isCertificateFailureReason(tls.reason)) {
      return { status: 'certificate', reason: tls.reason };
    }
  }

  return { status: responses.every((response) => !response) ? 'unreachable' : 'unknown' };
}

export async function probeConnection(settings: OpencodeConnectionSettings, signal?: AbortSignal): Promise<ConnectionProbeResult> {
  // A missing or expired OpenID Connect session is a distinct setup state: the
  // form keeps its options and offers Sign in instead of reporting the server
  // as unreachable or its credentials as wrong.
  if (settings.oidc) {
    const { isOidcAuthError } = await import('@/shared/auth/oidc/errors');
    try {
      const { getOidcAccessToken } = await import('@/shared/auth/oidc/session');
      await getOidcAccessToken(settings, settings.oidc, { signal });
    } catch (error) {
      if (isOidcAuthError(error) && error.code === 'sign-in-required') return { status: 'openid-sign-in-required' };
    }
  }
  return withTemporaryTrust(settings, () => probeV2(settings, signal));
}

export async function detectServerContract(settings: OpencodeConnectionSettings, signal?: AbortSignal): Promise<ContractProbeResult> {
  const result = await probeConnection(settings, signal);
  // Setup must preserve uncertainty; existing connection fallback starts with V2.
  return result.status === 'detected' ? { contract: result.contract, version: result.version } : { contract: 'v2' };
}
