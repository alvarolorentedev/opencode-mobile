import { getConnectCatalog, type ConnectStore } from '@/lib/connect';
import { queryOptions } from '@tanstack/react-query';
// Native product eligibility and purchase/entitlement checkpoints remain in
// the billing workflow; only the public HTTP catalog belongs here.
export function connectCatalogOptions(controlPlaneUrl: string, store: ConnectStore) {
  return queryOptions({ queryKey: ['cloudlink', controlPlaneUrl, store, 'catalog'], staleTime: 300_000,
    queryFn: ({ signal }) => getConnectCatalog(controlPlaneUrl, signal) });
}
