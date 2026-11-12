export type RelayEnvironment = {
  id: string;
  name: string;
  status: string;
  hostname?: string;
  version?: string;
  platform?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001F\u007F]/.test(value);
}

export function normalizeRelayUrl(value: string): string | undefined {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input)) return undefined;
  const rawPath = input.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/, 1)[0] || '/';
  if (rawPath.split('/').some((segment) => {
    try { const decoded = decodeURIComponent(segment); return decoded === '.' || decoded === '..'; }
    catch { return true; }
  })) return undefined;
  try {
    const url = new URL(input);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) return undefined;
    if (url.pathname.split('/').some((segment) => {
      try { const decoded = decodeURIComponent(segment); return decoded === '.' || decoded === '..'; }
      catch { return true; }
    })) return undefined;
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

export function parseRelayToken(value: unknown): string | undefined {
  if (!isRecord(value) || !boundedText(value.token, 4096) || !/^[\x21-\x7E]+$/.test(value.token)) return undefined;
  return value.token;
}

export function parseRelayEnvironments(value: unknown): RelayEnvironment[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.environments) || value.environments.length > 500) return undefined;
  const environments: RelayEnvironment[] = [];
  const ids = new Set<string>();
  for (const item of value.environments) {
    if (!isRecord(item) || !boundedText(item.id, 256) || !boundedText(item.name, 256) || !boundedText(item.status, 64)) return undefined;
    if (ids.has(item.id)) return undefined;
    ids.add(item.id);
    for (const key of ['hostname', 'version', 'platform'] as const) {
      if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 256 || /[\u0000-\u001F\u007F]/.test(item[key] as string))) return undefined;
    }
    environments.push({
      id: item.id,
      name: item.name,
      status: item.status,
      ...(typeof item.hostname === 'string' ? { hostname: item.hostname } : {}),
      ...(typeof item.version === 'string' ? { version: item.version } : {}),
      ...(typeof item.platform === 'string' ? { platform: item.platform } : {}),
    });
  }
  return environments;
}
