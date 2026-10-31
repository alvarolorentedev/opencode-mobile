import { setServerQueryOnline } from '@/providers/queries/client';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import {
  DEFAULT_NETWORK_STATUS,
  normalizeNetworkState,
  type NetworkStatus,
} from '@/lib/network-status';

// Provider-owned connectivity snapshot. NetInfo is sampled only after mount so
// screens never read the platform module directly and a web/E2E runtime can
// still start with a deterministic "online" state.
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(DEFAULT_NETWORK_STATUS);

  useEffect(() => {
    let active = true;
    // Never make an external reachability probe. A captive portal or a blocked
    // probe must not be mistaken for an offline OpenCode server; request
    // failures remain authoritative.
    NetInfo.configure({ reachabilityShouldRun: () => false, shouldFetchWiFiSSID: false });
    const apply = (state: Parameters<typeof normalizeNetworkState>[0]) => {
      if (!active) return;
      const next = normalizeNetworkState(state);
      setServerQueryOnline(next.online);
      setStatus((current) => current.online === next.online && current.type === next.type
        && current.expensive === next.expensive && current.constrained === next.constrained
        && current.generation === next.generation ? current : next);
    };
    // `addEventListener` immediately invokes the listener with the current
    // state on native, so the first sample does not wait for a transition.
    const unsubscribe = NetInfo.addEventListener(apply);
    void NetInfo.fetch().then(apply).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return status;
}
