// Canonical connection scopes encode the server URL and username, not a hash.
// Native Lock Screen surfaces use a one-way reference instead; resolution only
// compares existing app-owned connections and never accepts a URL from the link.
const PREFIX = 'activity-sha256:';

export async function privateConnectionReference(scope: string): Promise<string> {
  const { CryptoDigestAlgorithm, digestStringAsync } = await import('expo-crypto');
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
  return `${PREFIX}${digest.toLowerCase()}`;
}

export async function findByConnectionReference<T>(
  entries: readonly T[],
  reference: string,
  scopeOf: (entry: T) => string,
): Promise<T | undefined> {
  const direct = entries.find((entry) => scopeOf(entry) === reference);
  if (direct) return direct;
  if (!/^activity-sha256:[a-f0-9]{64}$/.test(reference)) return undefined;
  for (const entry of entries) {
    if (await privateConnectionReference(scopeOf(entry)) === reference) return entry;
  }
  return undefined;
}
