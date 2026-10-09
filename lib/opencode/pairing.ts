import { decode as decodeBase64 } from 'base-64';

import { fetchConnection } from './client/fetch';
import { probeConnection } from './client/probe';
import { joinUrlPath, normalizeServerUrl } from './client/url';

export type LocalPairing = { urls: string[] } & ({ code: string } | { password: string });
export type PairingFailure = 'invalid' | 'expired' | 'unreachable' | 'loopback';
export class LocalPairingError extends Error {
  constructor(public reason: PairingFailure) { super(reason); }
}

function serverAddress(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || (value.includes('://') && !/^https?:\/\//i.test(value.trim()))) return;
  const normalized = normalizeServerUrl(value);
  if (!normalized.valid) return;
  const url = new URL(normalized.displayUrl);
  const original = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol) || original.username || original.password || original.search || original.hash) return;
  return normalized.displayUrl;
}

function credentials(value: unknown): { password: string } | undefined {
  if (!value || typeof value !== 'object') return;
  const entry = value as Record<string, unknown>;
  if (entry.username !== 'opencode' || typeof entry.password !== 'string' || entry.password.length > 4096) return;
  return { password: entry.password };
}

export function parseLocalPairing(value: string): LocalPairing {
  try {
    if (value.length > 16_384) throw new Error();
    const trimmed = value.trim();
    let payload: Record<string, unknown>;
    if (trimmed.startsWith('{')) {
      payload = JSON.parse(trimmed);
    } else {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      const match = /^(.*)\/auth\/connect\/([A-Za-z0-9_-]{1,256})$/.exec(url.pathname);
      if (match && !url.search && !url.hash) {
        payload = { code: match[2], urls: [`${url.origin}${match[1]}`] };
      } else if (url.pathname.endsWith('/connect')) {
        const data = url.hash.slice(1) || url.searchParams.get('data');
        if (!data) throw new Error();
        const bytes: string = decodeBase64(decodeURIComponent(data).replace(/-/g, '+').replace(/_/g, '/'));
        const secret = credentials(JSON.parse(decodeURIComponent(Array.from(bytes, (byte) => `%${byte.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))));
        if (!secret) throw new Error();
        payload = { urls: [`${url.origin}${url.pathname.slice(0, -8)}`], username: 'opencode', ...secret };
      } else throw new Error();
    }
    if (!payload || !Array.isArray(payload.urls) || !payload.urls.length || payload.urls.length > 16) throw new Error();
    const addresses = payload.urls.map(serverAddress);
    if (addresses.some((url) => !url)) throw new Error();
    const urls = [...new Set(addresses as string[])];
    if (typeof payload.code === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(payload.code)) return { urls, code: payload.code };
    const secret = credentials(payload);
    if (secret) return { urls, ...secret };
  } catch { /* Invalid codes must never start a request. */ }
  throw new LocalPairingError('invalid');
}

function isDeviceLocal(url: string) {
  const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.startsWith('127.') || hostname === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:/.test(hostname) || hostname === '0.0.0.0' || hostname === '[::]';
}

export async function resolveLocalPairing(value: string, signal?: AbortSignal) {
  const pairing = parseLocalPairing(value);
  const urls = pairing.urls.filter((url) => !isDeviceLocal(url));
  if (!urls.length) throw new LocalPairingError('loopback');
  let expired = false;
  for (const serverUrl of urls) {
    if (signal?.aborted) throw new Error('Aborted');
    if ('password' in pairing) {
      const settings = { serverUrl, username: '', password: pairing.password, directory: '' };
      const result = await probeConnection(settings, signal);
      if (result.status === 'detected' && result.contract === 'v2') return settings;
      continue;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 5000);
    try {
      const base = normalizeServerUrl(serverUrl);
      const path = joinUrlPath(base.pathPrefix.replace(/\/api$/, ''), `/auth/connect/${pairing.code}`);
      const response = await fetchConnection(`${base.origin}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
      if (response.status === 401) { expired = true; continue; }
      if (!response.ok) continue;
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string' || !body.token || body.token.length > 4096) continue;
      return { serverUrl, username: '', password: body.token, directory: '' };
    } catch { /* Try the next address without exposing a pairing code in an error. */ }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw new LocalPairingError(expired ? 'expired' : 'unreachable');
}
