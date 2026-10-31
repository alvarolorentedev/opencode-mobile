

// Custom request headers are credentials for gateways in front of the server
// (Cloudflare Access service tokens, Authelia, oauth2-proxy, corporate proxies).
// Every value therefore lives in Keychain/Keystore-backed storage, never in the
// AsyncStorage profile/workspace metadata. The header names are stored with the
// values so the editor can list them without a separate plaintext index.
export type ConnectionHeaders = Record<string, string>;

export const MAX_CONNECTION_HEADERS = 10;

export const MAX_CONNECTION_HEADER_NAME_LENGTH = 128;

export const MAX_CONNECTION_HEADER_VALUE_LENGTH = 4096;

// RFC 7230 token characters.
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Headers the transport or the app must own. Basic auth stays the app's
// Authorization mechanism, and framing headers would fight the fetch layer.
const RESERVED_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'expect',
  'host',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type ConnectionHeaderRow = { name: string; value: string };

export type ConnectionHeaderError = 'name' | 'value' | 'duplicate' | 'reserved' | 'limit';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validates editor rows and returns a canonical map. Blank rows are ignored so
// an untouched "Add header" affordance never blocks saving.
export function parseConnectionHeaders(rows: ConnectionHeaderRow[]): { headers?: ConnectionHeaders; error?: ConnectionHeaderError } {
  const headers: ConnectionHeaders = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value;
    if (!name && !value.trim()) continue;
    if (!name || name.length > MAX_CONNECTION_HEADER_NAME_LENGTH || !HEADER_NAME_PATTERN.test(name)) return { error: 'name' };
    if (value.length > MAX_CONNECTION_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(value)) return { error: 'value' };
    const key = name.toLowerCase();
    if (RESERVED_HEADERS.has(key)) return { error: 'reserved' };
    if (seen.has(key)) return { error: 'duplicate' };
    seen.add(key);
    headers[name] = value;
  }
  if (seen.size > MAX_CONNECTION_HEADERS) return { error: 'limit' };
  return { headers };
}

// Stored values are validated on write, but reads still sanitize so a corrupt
// or legacy record can never smuggle a reserved/invalid header into requests.
export function parseStoredConnectionHeaders(value: unknown): ConnectionHeaders {
  if (!isRecord(value)) return {};
  const headers: ConnectionHeaders = {};
  const seen = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (Object.keys(headers).length >= MAX_CONNECTION_HEADERS) break;
    const name = rawName.trim();
    if (!name || name.length > MAX_CONNECTION_HEADER_NAME_LENGTH || !HEADER_NAME_PATTERN.test(name)) continue;
    if (typeof rawValue !== 'string' || rawValue.length > MAX_CONNECTION_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(rawValue)) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || RESERVED_HEADERS.has(key)) continue;
    seen.add(key);
    headers[name] = rawValue;
  }
  return headers;
}

export function hasConnectionHeaders(headers: ConnectionHeaders | undefined) {
  return Boolean(headers && Object.keys(headers).length > 0);
}

// Stable representation for connect keys and change detection. Header names are
// case-insensitive, so compare by lowercase name and ignore the user's spelling
// and insertion order.
export function connectionHeadersKey(headers: ConnectionHeaders | undefined) {
  return JSON.stringify(Object.entries(headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function sameConnectionHeaders(left: ConnectionHeaders | undefined, right: ConnectionHeaders | undefined) {
  return connectionHeadersKey(left) === connectionHeadersKey(right);
}
