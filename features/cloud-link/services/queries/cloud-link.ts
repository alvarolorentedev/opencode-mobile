import { getConnectCatalog } from '@/shared/protocol/cloud-link/connect';
import type { ConnectStore } from '@/shared/contracts/cloud-link';
import { queryOptions } from '@tanstack/react-query';
// Native product eligibility and purchase/entitlement checkpoints remain in
// the billing workflow; only the public HTTP catalog belongs here.
export function connectCatalogOptions(controlPlaneUrl: string, store: ConnectStore) {
  // The provider reads this catalog outside React observers to attribute store
  // purchases; the default five-minute gc would evict it and silently drop
  // paid transactions until the next cold start.
  return queryOptions({ queryKey: ['cloudlink', controlPlaneUrl, store, 'catalog'], staleTime: 300_000, gcTime: Infinity,
    queryFn: ({ signal }) => getConnectCatalog(controlPlaneUrl, signal) });
}
