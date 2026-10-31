export type ProviderOAuthRedirect = {
  code?: string;
  error?: string;
};

// OAuth providers return the authorization code or an error in either the query
// string or the fragment. This reads both without assuming which the server used.
export function parseProviderOAuthRedirect(url: string): ProviderOAuthRedirect {
  const result: ProviderOAuthRedirect = {};

  const read = (params: URLSearchParams) => {
    const code = params.get('code');
    const error = params.get('error_description') || params.get('error');
    if (code && !result.code) result.code = code;
    if (error && !result.error) result.error = error;
  };

  try {
    const parsed = new URL(url);
    read(parsed.searchParams);
    if (parsed.hash) read(new URLSearchParams(parsed.hash.replace(/^#/, '')));
  } catch {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex >= 0) read(new URLSearchParams(url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)));
    if (hashIndex >= 0) read(new URLSearchParams(url.slice(hashIndex + 1)));
  }

  return result;
}

// Device/pairing flows carry a user code inside the provider's instruction text
// (for example "Enter code: 8F43-6FCF"). The protocol exposes no separate code
// field, so best-effort pull a code-like token out for a dedicated copy control.
// Returns undefined for code-paste instructions that contain no code.
export function extractPairingCode(instructions?: string): string | undefined {
  if (!instructions) return undefined;
  const match = instructions.match(/\bcode\b[^A-Za-z0-9]{0,4}([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i);
  return match?.[1];
}
