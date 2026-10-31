import { defaultConnectionSettings, type NormalizedServerUrl } from '@/shared/protocol/opencode/client/types';

export function joinUrlPath(prefix: string, pathname: string) {
  const normalizedPrefix = prefix === '/' ? '' : prefix.replace(/\/$/, '');
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedPrefix}${normalizedPathname}`;
}

export function normalizeServerUrl(value: string): NormalizedServerUrl {
  const trimmed = value.trim();
  if (!trimmed) {
    return normalizeServerUrl(defaultConnectionSettings.serverUrl);
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const displayUrl = `${parsed.origin}${pathPrefix}`;

    return {
      displayUrl,
      origin: parsed.origin,
      pathPrefix,
      valid: Boolean(parsed.hostname) && stripServerUrlCredentials(trimmed) === trimmed,
    };
  } catch {
    return {
      displayUrl: trimmed,
      origin: new URL(defaultConnectionSettings.serverUrl).origin,
      pathPrefix: '',
      valid: false,
    };
  }
}

// Legacy metadata may contain URL credentials which the transport never used.
export function stripServerUrlCredentials(value: string) {
  // Native URL has getter-only userinfo fields. Scrub the authority directly,
  // including malformed legacy URLs, without changing paths or queries.
  return value.trim().replace(/^((?:[a-z][a-z\d+.-]*:\/\/)?)[^/?#]*@/i, '$1');
}

export function getNormalizedServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).displayUrl;
}

export function getServerHostname(serverUrl: string) {
  const base = normalizeServerUrl(serverUrl);
  return base.valid ? new URL(base.origin).hostname : '';
}

export function isValidServerUrl(serverUrl: string) {
  return normalizeServerUrl(serverUrl).valid;
}

export function getServerBase(serverUrl: string) {
  return normalizeServerUrl(serverUrl);
}
