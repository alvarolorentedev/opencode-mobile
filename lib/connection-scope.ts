import { encode as encodeBase64 } from 'base-64';

// A connection is identified by the server it talks to plus the user it
// authenticates as. The password is deliberately excluded so this identity can
// be embedded in AsyncStorage keys, favorites, and pending notification
// records. `getConnectionScope()` is the single canonical helper for that
// identity; do not re-derive it elsewhere.
export type ConnectionIdentity = {
  serverUrl: string;
  username: string;
};

type NormalizedConnectionUrl = {
  /** Lowercased scheme/host/port origin, or the trimmed input when unparsable. */
  origin: string;
  /** Case-preserving path (trailing slashes removed) plus query. */
  pathAndQuery: string;
  valid: boolean;
};

/**
 * Normalizes the parts of a server URL that are case-insensitive while
 * preserving the parts that are case-sensitive.
 *
 * The WHATWG URL parser lowercases the scheme and hostname (and drops default
 * ports) but leaves `pathname` and `search` untouched, which is exactly the
 * behavior this app needs: `https://Example.com/OpenCode` and
 * `https://example.com/opencode` are different connections, while
 * `https://Example.com/` and `https://example.com` are the same one.
 */
export function normalizeConnectionUrl(serverUrl: string): NormalizedConnectionUrl {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    return { origin: '', pathAndQuery: '', valid: false };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return {
      origin: parsed.origin,
      pathAndQuery: `${pathname}${parsed.search}`,
      valid: Boolean(parsed.hostname),
    };
  } catch {
    // Unparsable input still gets a deterministic identity so keys stay stable.
    return { origin: withProtocol.replace(/\/+$/, ''), pathAndQuery: '', valid: false };
  }
}

/**
 * Deterministic, password-free identity for one server + user.
 *
 * The result is URL-safe base64 (alphanumerics plus `-` and `_`), so it can be
 * concatenated into AsyncStorage keys and compared for equality without any
 * escaping. It is an encoding, not a hash: equal identities always produce the
 * same scope and different identities never collide.
 */
export function getConnectionScope({ serverUrl, username }: ConnectionIdentity): string {
  const url = normalizeConnectionUrl(serverUrl);
  return toKeySegment(`${url.origin}${url.pathAndQuery}\n${username.trim()}`);
}

function toKeySegment(value: string): string {
  return encodeBase64(toUtf8BinaryString(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// `base-64` expects a binary string. `encodeURIComponent` is used instead of
// TextEncoder so the identity stays available on every platform the app runs
// on, including older Hermes builds.
function toUtf8BinaryString(value: string): string {
  const percentEncoded = encodeURIComponent(value);
  let binary = '';
  for (let index = 0; index < percentEncoded.length; index += 1) {
    const char = percentEncoded[index];
    if (char === '%') {
      binary += String.fromCharCode(Number.parseInt(percentEncoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      binary += char;
    }
  }
  return binary;
}
