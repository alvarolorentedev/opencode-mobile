import { OpenCode } from '@opencode/client';
import { createPrefixFetch, getRequestHeaders, type OpencodeConnectionSettings } from '../client';
import { bustConfigReadCache } from './config-read-cache';
import { resolveV2Base, type RawCredential, type V2Context } from './shared';
export function buildV2Raw(settings: OpencodeConnectionSettings, signal?: AbortSignal): V2Context {
  const { base, pathPrefix } = resolveV2Base(settings);
  const headers = getRequestHeaders(settings);
  const fetch = createPrefixFetch(base.origin, pathPrefix, settings, signal);
  const sdkFetch: typeof globalThis.fetch = async (input, init) => {
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined);
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const response = await fetch(bustConfigReadCache(url, method) ?? input, init);
    if (response.ok) return response;
    const text = await response.text();
    let cause: unknown;
    try { cause = JSON.parse(text); } catch { cause = text; }
    const record = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
    const detail = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : response.statusText;
    throw Object.assign(new Error(`OpenCode request failed (${response.status}): ${detail}`), { status: response.status, cause });
  };
  const api = OpenCode.make({ baseUrl: base.origin, headers, fetch: sdkFetch });
  // The installed SDK types credential mutations but not account listing.
  const listCredentials = async (): Promise<RawCredential[]> => {
    const response = await fetch(new URL('/api/credential', base.origin).toString(), { headers });
    if (response.status === 404 || response.status === 405) return [];
    if (!response.ok) throw new Error(`Could not load provider accounts (${response.status}).`);
    const body = await response.json() as { data?: RawCredential[] };
    return Array.isArray(body.data) ? body.data : [];
  };
  return { api, directory: settings.directory.trim() || undefined, listCredentials, permissionSession: new Map(), formSession: new Map() };
}
