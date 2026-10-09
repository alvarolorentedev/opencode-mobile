import { fetchConnection, getRequestHeaders } from './fetch';
import { joinUrlPath, normalizeServerUrl } from './url';
import type { OpencodeConnectionSettings, ServerContract } from './types';

export type ContractProbeResult = { contract: ServerContract; version?: string };
export type ConnectionProbeResult =
  | ({ status: 'detected' } & ContractProbeResult)
  | { status: 'authentication-required' | 'unreachable' | 'unknown' };

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

export async function probeConnection(settings: OpencodeConnectionSettings, signal?: AbortSignal): Promise<ConnectionProbeResult> {
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

  const v1Health = health && typeof health.version === 'string' && /^1\./.test(health.version) ? health.version : undefined;
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
  return { status: responses.every((response) => !response) ? 'unreachable' : 'unknown' };
}

export async function detectServerContract(settings: OpencodeConnectionSettings): Promise<ContractProbeResult> {
  const result = await probeConnection(settings);
  // Setup must preserve uncertainty; existing connection fallback still starts with V1.
  return result.status === 'detected' ? { contract: result.contract, version: result.version } : { contract: 'v1' };
}
