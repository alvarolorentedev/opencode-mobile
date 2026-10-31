import type { Purchase } from 'expo-iap';

import type { ConnectCatalog, ConnectSession, ConnectStore } from '@/shared/contracts/cloud-link';
import { AVAILABLE_CONNECT_PURCHASES, isConnectPurchase, type ConnectStoreApi } from '@/shared/platform/billing/connect-store';
import type { ConnectPhase } from '@/features/cloud-link/state/connect/catalog';
import { finalizeConnectPurchase, type PendingConnectPurchase } from '@/features/cloud-link/services/connect-subscription-service';

export async function finishConnectPurchase({
  controlPlaneUrl,
  store,
  apiRef,
  pendingPurchase,
  sessionRef,
  setSession,
  setPhase,
  setNotice,
  setPurchaseRecovery,
  finishedPurchases,
}: {
  controlPlaneUrl: string;
  store: ConnectStore;
  apiRef: { current: ConnectStoreApi | undefined };
  pendingPurchase: { current: PendingConnectPurchase | undefined };
  sessionRef: { current: ConnectSession | undefined };
  setSession: (session: ConnectSession | undefined) => void;
  setPhase: (phase: ConnectPhase) => void;
  setNotice: (notice: string | undefined) => void;
  setPurchaseRecovery: (recovery: 'unverified' | 'verified' | undefined) => void;
  finishedPurchases: { current: Set<string> };
}, purchase: Purchase): Promise<boolean> {
  const api = apiRef.current;
  if (!api) throw new Error('The native store is not ready. Retry or restart the app.');
  if (purchase.purchaseState !== 'purchased') {
    setPhase('pending'); setNotice('Purchase is pending store approval. No access has been granted.'); return false;
  }
  let pending = pendingPurchase.current;
  if (!pending || pending.purchase.id !== purchase.id) pendingPurchase.current = pending = { purchase };
  try { await finalizeConnectPurchase(controlPlaneUrl, store, pending, api, setPhase); }
  finally {
    if (pending.persisted) { sessionRef.current = pending.session; setSession(pending.session); }
    setPurchaseRecovery(pending.session ? 'verified' : 'unverified');
    setPhase('idle');
  }
  finishedPurchases.current.add(purchase.id);
  pendingPurchase.current = undefined;
  setPurchaseRecovery(undefined);
  return true;
}

export async function listConnectPurchases({
  apiRef,
  catalog,
  store,
}: {
  apiRef: { current: ConnectStoreApi | undefined };
  catalog: ConnectCatalog | undefined;
  store: ConnectStore;
}) {
  const api = apiRef.current;
  if (!api) throw new Error('Purchases and Restore require a native development/store build.');
  const purchases = await api.getAvailablePurchases(AVAILABLE_CONNECT_PURCHASES);
  return purchases.filter((purchase) => isConnectPurchase(catalog, purchase, store) && purchase.purchaseState === 'purchased').sort((a, b) => b.transactionDate - a.transactionDate);
}

export async function recoverConnectSession({
  pendingPurchase,
  sessionRef,
  availablePurchases,
  finishPurchase,
}: {
  pendingPurchase: { current: PendingConnectPurchase | undefined };
  sessionRef: { current: ConnectSession | undefined };
  availablePurchases: () => Promise<Purchase[]>;
  finishPurchase: (purchase: Purchase) => Promise<boolean>;
}) {
  const purchases = await availablePurchases();
  const purchase = pendingPurchase.current?.purchase ?? purchases[0];
  if (!purchase) throw new Error('No Cloud Link subscription is available in this store. Purchase or use Restore with the original store account.');
  await finishPurchase(purchase);
  return sessionRef.current!;
}
