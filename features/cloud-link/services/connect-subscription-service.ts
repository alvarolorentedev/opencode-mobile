import type { Purchase } from 'expo-iap';

import { claimConnectSubscription, ConnectApiError } from '@/shared/protocol/cloud-link/connect';
import { CONNECT_PRODUCTION_URL, CONNECT_STAGING_URL, type ConnectSession, type ConnectStore } from '@/shared/contracts/cloud-link';
import { saveConnectSession } from '@/shared/storage/cloud-link';
import { connectPurchaseProof, type ConnectStoreApi } from '@/shared/platform/billing/connect-store';

// Checkpoint belongs to the provider. Retrying storage/finalization reuses the
// granted session; after restart the same native proof can be claimed again.
export type PendingConnectPurchase = { purchase: Purchase; controlPlaneUrl?: string; session?: ConnectSession; persisted?: boolean };

// Internal orchestration signal: switch scope after the current operation
// releases its lock, then resume the same native transaction.
export class ConnectPurchaseEnvironmentChange extends Error {
  constructor(public controlPlaneUrl: string) { super('The purchase requires a different Cloud Link environment.'); }
}

export async function finalizeConnectPurchase(controlPlaneUrl: string, store: ConnectStore, pending: PendingConnectPurchase, api: ConnectStoreApi,
  onPhase: (phase: 'verifying' | 'savingSession' | 'finalizing') => void) {
  if (pending.purchase.purchaseState !== 'purchased') throw new Error('The store purchase is pending approval.');
  pending.controlPlaneUrl ??= store === 'apple' && 'environmentIOS' in pending.purchase && pending.purchase.environmentIOS?.toLowerCase() === 'sandbox'
    ? CONNECT_STAGING_URL : CONNECT_PRODUCTION_URL;
  if (pending.controlPlaneUrl !== controlPlaneUrl) throw new ConnectPurchaseEnvironmentChange(pending.controlPlaneUrl);
  if (!pending.session) {
    onPhase('verifying');
    const proof = await connectPurchaseProof(pending.purchase, api, store);
    try { pending.session = await claimConnectSubscription(controlPlaneUrl, proof); }
    catch (reason) {
      if (store === 'google' && controlPlaneUrl === CONNECT_PRODUCTION_URL && reason instanceof ConnectApiError && reason.testPurchase) {
        pending.controlPlaneUrl = CONNECT_STAGING_URL;
        throw new ConnectPurchaseEnvironmentChange(CONNECT_STAGING_URL);
      }
      const message = reason instanceof ConnectApiError && [400, 401, 403].includes(reason.status)
        ? `The control plane rejected the store purchase (HTTP ${reason.status}).`
        : reason instanceof Error ? reason.message : 'Try again.';
      throw new Error(`Subscription verification failed at ${controlPlaneUrl}. ${message} Retry or Restore without purchasing again.`);
    }
  }
  if (!pending.persisted) {
    onPhase('savingSession');
    try { await saveConnectSession(controlPlaneUrl, store, pending.session); }
    catch { throw new Error('Subscription verified, but secure session saving failed. Retry saving without purchasing again.'); }
    pending.persisted = true;
  }
  // StoreKit requires the app to finish the transaction; unfinished iOS
  // transactions replay until finished. Google Play is acknowledged by the
  // control plane on claim with a durable retry, so the app never acknowledges
  // Play itself (a second acknowledge can fail and would race the backend).
  if (store === 'apple') {
    onPhase('finalizing');
    try { await api.finishTransaction({ purchase: pending.purchase, isConsumable: false }); }
    catch { throw new Error('Session saved, but store finalization failed. Retry finalization without purchasing again.'); }
  }
  return pending.session;
}
