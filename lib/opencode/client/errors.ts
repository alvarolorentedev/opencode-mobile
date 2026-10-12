import { normalizeServerUrl } from './url';

export function isRetryableCloudLinkStartupError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const descriptions: string[] = [];
  while (error && !seen.has(error)) {
    seen.add(error);
    if (typeof error === 'string') { descriptions.push(error); break; }
    if (typeof error !== 'object') break;
    const record = error as { message?: unknown; domain?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (record.status === 401 || record.status === 403) return false;
    descriptions.push(typeof record.message === 'string' ? record.message : '', typeof record.domain === 'string' ? record.domain : '', typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : '');
    error = record.cause;
  }
  const message = descriptions.join(' ');
  // Generic fetch failures can conceal certificate failures. Only retry identified transport errors.
  if (/\b(?:401|403)\b|credential|entitlement|certificate|(?:^|[^a-z])(?:TLS|SSL|CERT)(?:[^a-z]|$)|NSURLErrorDomain.*-120[0-6]\b|invalid.*url|unsafe.*url/i.test(message)) return false;
  return /\b1033\b|\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ESOCKETTIMEDOUT)\b|(?:unable|failed|could not) to resolve host|name or service not known|nodename nor servname|DNS.*(?:resolution|lookup|failed)|(?:connection|request|connect) timed? ?out|connection reset|NSURLErrorDomain.*(?:-1001|-1003|-1005|-1006)\b/i.test(message);
}

export function getConnectionErrorMessage(error: unknown, serverUrl: string) {
  // The V1 SDK throws non-JSON error pages as strings.
  if (typeof error === 'string') error = new Error(error);
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.valid) {
    return 'Enter a complete server URL, such as http://192.168.1.10:4096.';
  }

  if (!(error instanceof Error)) {
    return 'Something went wrong while talking to OpenCode.';
  }

  const normalizedUrl = normalized.displayUrl;
  const message = error.message || 'Something went wrong while talking to OpenCode.';
  const alreadyApiBase = /\/api$/i.test(normalizedUrl);
  const apiHint = alreadyApiBase
    ? ''
    : ` If this address serves a web UI, use its API base URL instead, usually ${normalizedUrl}/api.`;
  const versionHint = alreadyApiBase
    ? ' This app supports OpenCode 1.x and 2.x servers; verify the API base URL is correct.'
    : '';

  if (/\b1033\b/.test(message)) {
    return 'The Cloudflare tunnel is still starting (Error 1033). Retry shortly.';
  }

  if (/unsupported.?content.?type|malformed.?response/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  if (/^UnexpectedStatus$/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/text\/html/i.test(message) || /not supported by this version/i.test(message)) {
    return `The server at ${normalizedUrl} returned a web page instead of the OpenCode API.${apiHint}${versionHint}`;
  }

  if (/404|not found/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  return message;
}

export function getConnectionError(serverUrl: string, error: unknown) {
  return getConnectionErrorMessage(error, serverUrl);
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
