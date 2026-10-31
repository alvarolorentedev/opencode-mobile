import { isConnectEntitlement, type ConnectCatalog, type ConnectStore } from '@/shared/contracts/cloud-link';
import { selectConnectOffers, type ConnectOffer, type ConnectStoreApi } from '@/shared/platform/billing/connect-store';

import type { ConnectPhase } from '@/shared/contracts/cloud-link-setup';
export type { ConnectPhase } from '@/shared/contracts/cloud-link-setup';

export async function loadConnectCatalog({
  catalog,
  store,
  apiRef,
  setOffers,
  setPhase,
}: {
  catalog: ConnectCatalog;
  store: ConnectStore;
  apiRef: { current: ConnectStoreApi | undefined };
  setOffers: (offers: ConnectOffer[]) => void;
  setPhase: (phase: ConnectPhase) => void;
}) {
  const api = apiRef.current;
  if (!api) throw new Error('Purchases and Restore require a native development/store build.');
  setPhase('catalog');
  const products = catalog.plans.filter((plan) => plan.entitlements.some(isConnectEntitlement)).flatMap((plan) => plan.products.filter((product) => product.store === store));
  if (!products.length) throw new Error('Cloud Link subscriptions are not configured for this store.');
  const native = await api.fetchProducts({ skus: [...new Set(products.map((product) => product.productId))], type: 'subs' });
  const subscriptions = native as import('expo-iap').ProductSubscription[];
  const eligible = new Set<string>();
  if (store === 'apple') await Promise.all(subscriptions.map(async (product) => {
    if (product.platform === 'ios' && product.subscriptionGroupIdIOS && product.subscriptionOffers?.some((offer) => offer.type === 'introductory')) {
      if (await api.isEligibleForIntroOfferIOS(product.subscriptionGroupIdIOS).catch(() => false)) eligible.add(product.id);
    }
  }));
  const choices = selectConnectOffers(catalog, subscriptions, store, eligible);
  if (!choices.length) throw new Error('No matching Cloud Link products, base plans, or eligible offers are available in this store.');
  setOffers(choices);
  setPhase('idle');
}
