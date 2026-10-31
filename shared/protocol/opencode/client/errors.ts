import { normalizeServerUrl } from '@/shared/contracts/server-url';

export type ConnectionFailureKind =
  | 'timeout'
  | 'offline'
  | 'auth'
  | 'entitlement'
  | 'tunnel-startup'
  | 'server-incompatible'
  | 'unknown';

function describeError(error: unknown) {
  const seen = new Set<unknown>();
  const descriptions: string[] = [];
  let status: number | undefined;
  while (error && !seen.has(error)) {
    seen.add(error);
    if (typeof error === 'string') { descriptions.push(error); break; }
    if (typeof error !== 'object') break;
    const record = error as { message?: unknown; domain?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (status === undefined && (record.status === 401 || record.status === 403)) status = record.status;
    descriptions.push(typeof record.message === 'string' ? record.message : '', typeof record.domain === 'string' ? record.domain : '', typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : '');
    error = record.cause;
  }
  return { status, message: descriptions.join(' ') };
}

const TUNNEL_STARTUP_PATTERN = /\b1033\b|cloudflare error 1033/i;
const AUTH_PATTERN = /credentials were rejected|credentials expired|credentials are missing|invalid cloud link profile|pair this device again|authentication required|unauthorized/i;
const ENTITLEMENT_PATTERN = /no active subscription|access was denied[^]*?(?:subscription|entitlement)|cloud link entitlement|entitlement/i;
const INSECURE_PATTERN = /certificate|(?:^|[^a-z])(?:TLS|SSL|CERT)(?:[^a-z]|$)|NSURLErrorDomain.*-120[0-6]\b|invalid.*url|unsafe.*url/i;
const INCOMPATIBLE_PATTERN = /unsupported.?content.?type|malformed.?response|text\/html|not supported by this version|unexpectedstatus|endpoint not found/i;
const OFFLINE_PATTERN = /\b(?:ENETUNREACH|ENETDOWN|ENETRESET|ECONNREFUSED)\b|network is unreachable|not connected to the internet|internet connection appears to be offline|\boffline\b|NSURLErrorDomain.*-1009\b/i;
const TIMEOUT_PATTERN = /\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|EPIPE)\b|(?:unable|failed|could not) to resolve host|name or service not known|nodename nor servname|DNS.*(?:resolution|lookup|failed)|(?:connection|request|connect) timed? ?out|connection reset|NSURLErrorDomain.*(?:-1001|-1003|-1005|-1006)\b/i;

// Recovery policy is keyed on this classification: auth/entitlement failures
// stop automatic retries, everything else stays bounded and retryable.
export function classifyConnectionFailure(error: unknown): ConnectionFailureKind {
  const { status, message } = describeError(error);
  if (TUNNEL_STARTUP_PATTERN.test(message)) return 'tunnel-startup';
  const explicitStatus = status ?? (/\b401\b/.test(message) ? 401 : /\b403\b/.test(message) ? 403 : undefined);
  if (explicitStatus === 401) return 'auth';
  if (explicitStatus === 403) return ENTITLEMENT_PATTERN.test(message) ? 'entitlement' : 'auth';
  if (AUTH_PATTERN.test(message)) return 'auth';
  if (ENTITLEMENT_PATTERN.test(message)) return 'entitlement';
  // Generic fetch failures can conceal certificate failures. Never retry them.
  if (INSECURE_PATTERN.test(message)) return 'unknown';
  if (INCOMPATIBLE_PATTERN.test(message)) return 'server-incompatible';
  if (OFFLINE_PATTERN.test(message)) return 'offline';
  if (TIMEOUT_PATTERN.test(message)) return 'timeout';
  return 'unknown';
}

export function isRetryableConnectionFailure(kind: ConnectionFailureKind) {
  return kind !== 'auth' && kind !== 'entitlement' && kind !== 'server-incompatible';
}

export function isAuthConnectionFailure(kind: ConnectionFailureKind) {
  return kind === 'auth' || kind === 'entitlement';
}

export function isRetryableCloudLinkStartupError(error: unknown): boolean {
  const { status, message } = describeError(error);
  if (status === 401 || status === 403) return false;
  // Generic fetch failures can conceal certificate failures. Only retry identified transport errors.
  if (/\b(?:401|403)\b|credential|entitlement|certificate|(?:^|[^a-z])(?:TLS|SSL|CERT)(?:[^a-z]|$)|NSURLErrorDomain.*-120[0-6]\b|invalid.*url|unsafe.*url/i.test(message)) return false;
  return /\b1033\b|\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ESOCKETTIMEDOUT)\b|(?:unable|failed|could not) to resolve host|name or service not known|nodename nor servname|DNS.*(?:resolution|lookup|failed)|(?:connection|request|connect) timed? ?out|connection reset|NSURLErrorDomain.*(?:-1001|-1003|-1005|-1006)\b/i.test(message);
}

export type ConnectionErrorTranslator = (key: string, options?: Record<string, unknown>) => string;

function fallbackTranslate(key: string, options: Record<string, unknown> = {}) {
  switch (key) {
    case 'settings:connection.errors.invalidUrl': return 'Enter a complete server URL, such as http://192.168.1.10:4096.';
    case 'settings:connection.errors.generic': return 'Something went wrong while talking to OpenCode.';
    case 'settings:connection.errors.tunnelStarting': return 'The Cloudflare tunnel is still starting (Error 1033). Retry shortly.';
    case 'settings:connection.errors.notApi': return `The server at ${options.url} did not return an OpenCode API response.${options.apiHint}${options.versionHint}`;
    case 'settings:connection.errors.endpointNotFound': return `OpenCode endpoint not found at ${options.url}.${options.apiHint}${options.versionHint}`;
    case 'settings:connection.errors.webPage': return `The server at ${options.url} returned a web page instead of the OpenCode API.${options.apiHint}${options.versionHint}`;
    case 'settings:connection.errors.apiHint': return ` If this address serves a web UI, use its API base URL instead, usually ${options.url}/api.`;
    case 'settings:connection.errors.versionHint': return ' This app supports OpenCode 1.x and 2.x servers; verify the API base URL is correct.';
    default: return key;
  }
}

export function getConnectionErrorMessage(error: unknown, serverUrl: string, translate?: ConnectionErrorTranslator) {
  const tr = translate ?? fallbackTranslate;
  // The V1 SDK throws non-JSON error pages as strings.
  if (typeof error === 'string') error = new Error(error);
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.valid) {
    return tr('settings:connection.errors.invalidUrl');
  }

  if (!(error instanceof Error)) {
    return tr('settings:connection.errors.generic');
  }

  const normalizedUrl = normalized.displayUrl;
  const message = error.message || tr('settings:connection.errors.generic');
  const alreadyApiBase = /\/api$/i.test(normalizedUrl);
  const apiHint = alreadyApiBase ? '' : tr('settings:connection.errors.apiHint', { url: normalizedUrl });
  const versionHint = alreadyApiBase ? tr('settings:connection.errors.versionHint') : '';

  if (/\b1033\b/.test(message)) {
    return tr('settings:connection.errors.tunnelStarting');
  }

  if (/unsupported.?content.?type|malformed.?response/i.test(message)) {
    return tr('settings:connection.errors.notApi', { url: normalizedUrl, apiHint, versionHint });
  }

  if (/^UnexpectedStatus$/i.test(message)) {
    return tr('settings:connection.errors.endpointNotFound', { url: normalizedUrl, apiHint, versionHint });
  }

  if (/text\/html/i.test(message) || /not supported by this version/i.test(message)) {
    return tr('settings:connection.errors.webPage', { url: normalizedUrl, apiHint, versionHint });
  }

  if (/404|not found/i.test(message)) {
    return tr('settings:connection.errors.endpointNotFound', { url: normalizedUrl, apiHint, versionHint });
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return tr('settings:connection.errors.notApi', { url: normalizedUrl, apiHint, versionHint });
  }

  return message;
}

export function getConnectionError(serverUrl: string, error: unknown, translate?: ConnectionErrorTranslator) {
  return getConnectionErrorMessage(error, serverUrl, translate);
}

export function isContractMismatchError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as Error & { status?: number; cause?: { status?: number } }).status
    ?? (error as Error & { cause?: { status?: number } }).cause?.status;
  if (status !== undefined) return status === 404 || status === 405;
  if (/\b(?:401|403|429|5\d\d)\b|authentication|unauthorized|forbidden|network|fetch failed|timed? ?out/i.test(error.message)) return false;
  return /unsupported.?content.?type|malformed.?response|text\/html|not supported by this version/i.test(error.message);
}
