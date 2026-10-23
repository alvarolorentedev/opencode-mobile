// Normalized connectivity for the provider and transport layers. This stays
// platform-neutral so the decision tables can be tested without NetInfo.
//
// Reachability is an acceleration signal, never proof that a particular server
// is reachable: a captive portal can report "online" while the OpenCode origin
// is unreachable. Callers pause retries on offline, but only request failures
// may surface a connection error.
export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'none' | 'other' | 'unknown';

export type NetworkStatus = {
  online: boolean;
  type: NetworkType;
  // Cellular links are metered even when fast. Consumers use this to choose a
  // lower polling cadence or warn before a large attachment upload.
  expensive: boolean;
  // Best-effort generation label from the native radio (2g/3g/4g/5g). Unknown
  // on platforms that do not expose it.
  generation?: string;
  // Constrained links keep the app usable, but background work should prefer
  // fewer, larger reads over many parallel ones.
  constrained: boolean;
};

type NetInfoLike = {
  type?: string;
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  details?: unknown;
};

export const DEFAULT_NETWORK_STATUS: NetworkStatus = {
  online: true,
  type: 'unknown',
  expensive: false,
  constrained: false,
};

function normalizeType(type: string | undefined): NetworkType {
  if (type === 'wifi' || type === 'cellular' || type === 'ethernet' || type === 'none') {
    return type;
  }
  return type ? 'other' : 'unknown';
}

function readGeneration(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as { cellularGeneration?: unknown }).cellularGeneration;
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : undefined;
}

export function normalizeNetworkState(state: NetInfoLike | undefined): NetworkStatus {
  if (!state) return DEFAULT_NETWORK_STATUS;
  const type = normalizeType(state.type);
  // Reachability is deliberately not authoritative. A reachability probe can
  // be disabled, blocked, or fooled by a captive portal; request failures are
  // the authority for a specific server. A disconnected radio is enough to
  // pause retries, and an unknown reachability flag must never force offline.
  const online = state.isConnected !== false && type !== 'none';
  const generation = readGeneration(state.details);
  const generationConstrained = generation === '2g' || generation === '3g';
  return {
    online,
    type,
    expensive: type === 'cellular',
    constrained: online && generationConstrained,
    ...(generation ? { generation } : {}),
  };
}

export function networkStatusKey(status: NetworkStatus) {
  return `${status.online ? 'online' : 'offline'}:${status.type}:${status.constrained ? 'constrained' : 'normal'}`;
}

export function isOfflineError(error: unknown) {
  return /\b(?:ENETUNREACH|ENETDOWN|ENETRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b|network(?: request failed| is unreachable| unavailable)|not connected to the internet|internet connection appears to be offline|\boffline\b|NSURLErrorDomain.*-1009\b/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
