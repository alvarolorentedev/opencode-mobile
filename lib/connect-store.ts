import Constants from 'expo-constants';
import type { ProductSubscription, Purchase, RequestPurchaseProps } from 'expo-iap';
import { Platform } from 'react-native';

import { getConnectStore, isConnectEnabled, isConnectEntitlement, type ConnectCatalog, type ConnectProof } from '@/lib/connect';

export type ConnectOffer = {
  key: string;
  productId: string;
  title: string;
  displayPrice: string;
  period?: { unit: string; value: number };
  phases: { price: string; period?: { unit: string; value: number }; cycles: number }[];
  basePlanId?: string;
  offerToken?: string;
};

type StoreApi = Pick<typeof import('expo-iap'), 'initConnection' | 'endConnection' | 'fetchProducts' | 'requestPurchase' | 'getAvailablePurchases' | 'restorePurchases' | 'deepLinkToSubscriptions' | 'finishTransaction' | 'getTransactionJwsIOS' | 'isEligibleForIntroOfferIOS' | 'getPendingTransactionsIOS' | 'purchaseUpdatedListener' | 'purchaseErrorListener'>;
type NativePurchaseError = Parameters<Parameters<StoreApi['purchaseErrorListener']>[0]>[0];
type StoreTest = {
  products: ProductSubscription[];
  purchases: Purchase[];
  nextPurchase?: Purchase;
  restoredPurchases?: Purchase[];
  pendingTransactions?: Purchase[];
  outcome?: 'pending' | 'canceled';
  finishFailures?: number;
  events: string[];
};

export function canUseConnectStore() {
  return isConnectEnabled() && Constants.executionEnvironment !== 'storeClient';
}

// Only the explicit E2E build uses this driver; product web never imports IAP.
export async function loadConnectStore(): Promise<StoreApi> {
  if (!canUseConnectStore()) throw new Error('Purchases and Restore require an iOS or Android development/store build, not Expo Go or web.');
  if (Platform.OS !== 'web') return import('expo-iap');
  const test = (globalThis as typeof globalThis & { __connectStoreTest?: StoreTest }).__connectStoreTest;
  if (!test) throw new Error('The development store fixture is unavailable.');
  let onPurchase: (purchase: Purchase) => void = () => undefined;
  let onError: (error: NativePurchaseError) => void = () => undefined;
  return {
    initConnection: async () => true,
    endConnection: async () => true,
    fetchProducts: async () => test.products,
    getAvailablePurchases: async () => { test.events.push('available'); return test.purchases; },
    restorePurchases: async () => { test.events.push('restore'); if (test.restoredPurchases) test.purchases = test.restoredPurchases; },
    deepLinkToSubscriptions: async () => { test.events.push('manage-subscription'); },
    getPendingTransactionsIOS: async () => test.pendingTransactions ?? [],
    requestPurchase: async () => {
      test.events.push('purchase');
      if (test.nextPurchase) test.purchases = [test.nextPurchase];
      setTimeout(() => {
        if (test.outcome === 'canceled') onError({ code: 'user-cancelled' as NativePurchaseError['code'], name: 'PurchaseError', message: 'Purchase canceled.' });
        else if (test.purchases[0]) onPurchase({ ...test.purchases[0], purchaseState: test.outcome === 'pending' ? 'pending' : 'purchased' });
      }, 0);
      return null;
    },
    finishTransaction: async ({ isConsumable }) => {
      if (isConsumable !== false) throw new Error('Subscriptions must not be consumed.');
      test.events.push('finish');
      if (test.finishFailures && test.finishFailures-- > 0) throw new Error('Store finalization unavailable.');
      test.purchases = test.purchases.map((purchase) => ({ ...purchase, isAcknowledgedAndroid: true }));
    },
    getTransactionJwsIOS: async (sku: string) => test.purchases.find((purchase) => purchase.productId === sku)?.purchaseToken ?? '',
    isEligibleForIntroOfferIOS: async () => false,
    purchaseUpdatedListener: (callback: typeof onPurchase) => { onPurchase = callback; return { remove: () => { onPurchase = () => undefined; } }; },
    purchaseErrorListener: (callback: typeof onError) => { onError = callback; return { remove: () => { onError = () => undefined; } }; },
  } as StoreApi;
}

export async function openConnectSubscriptionManagement() {
  const api = await loadConnectStore();
  if (Platform.OS === 'android') {
    const packageNameAndroid = Constants.expoConfig?.android?.package;
    if (!packageNameAndroid) throw new Error('The Android app package is unavailable.');
    await api.deepLinkToSubscriptions({ packageNameAndroid });
  } else {
    await api.deepLinkToSubscriptions();
  }
}

export function selectConnectOffers(catalog: ConnectCatalog, products: ProductSubscription[], store = getConnectStore(), introEligible = new Set<string>()): ConnectOffer[] {
  const configured = catalog.plans.filter((plan) => plan.entitlements.some(isConnectEntitlement)).flatMap((plan) => plan.products).filter((product) => product.store === store);
  const result: ConnectOffer[] = [];
  for (const item of configured) {
    const native = products.find((product) => product.id === item.productId && product.type === 'subs' && product.platform === (store === 'apple' ? 'ios' : 'android'));
    if (!native) continue;
    if (item.store === 'apple' && native.platform === 'ios') {
      if (native.isFamilyShareableIOS) continue;
      result.push({ key: item.productId, productId: item.productId, title: native.title, displayPrice: native.displayPrice,
        period: native.subscriptionPeriodUnitIOS ? { unit: native.subscriptionPeriodUnitIOS, value: Number(native.subscriptionPeriodNumberIOS ?? 1) } : undefined,
        phases: introEligible.has(item.productId) ? (native.subscriptionOffers ?? []).filter((offer) => offer.type === 'introductory').map((offer) => ({ price: offer.displayPrice, period: offer.period ?? undefined, cycles: offer.periodCount ?? offer.numberOfPeriodsIOS ?? 1 })) : [] });
    } else if (item.store === 'google' && native.platform === 'android') {
      for (const offer of native.subscriptionOffers) {
        if (offer.basePlanIdAndroid !== item.basePlanId || !offer.offerTokenAndroid || (offer.id && offer.id !== item.basePlanId && !item.offerIds.includes(offer.id))) continue;
        const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
        result.push({ key: `${item.productId}:${item.basePlanId}:${offer.id}`, productId: item.productId, basePlanId: item.basePlanId,
          offerToken: offer.offerTokenAndroid, title: native.title, displayPrice: offer.displayPrice, period: offer.period ?? undefined,
          phases: phases.length > 1 || phases.some((phase) => phase.billingCycleCount > 0) ? phases.map((phase) => ({ price: phase.formattedPrice, period: parseBillingPeriod(phase.billingPeriod), cycles: phase.billingCycleCount })) : [] });
      }
    }
  }
  return result;
}

export const AVAILABLE_CONNECT_PURCHASES = { onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false };

export function isConnectPurchase(catalog: ConnectCatalog | undefined, purchase: Purchase, store = getConnectStore()) {
  return purchase.store === store && Boolean(catalog?.plans.some((plan) => plan.entitlements.some(isConnectEntitlement) && plan.products.some((product) => product.store === store && product.productId === purchase.productId)));
}

export function connectPurchaseRequest(offer: ConnectOffer, previous?: Purchase, store = getConnectStore()): RequestPurchaseProps {
  if (store === 'apple') return { type: 'subs', request: { apple: { sku: offer.productId, andDangerouslyFinishTransactionAutomatically: false } } };
  if (!offer.offerToken || !offer.basePlanId) throw new Error('The selected Google base plan is unavailable.');
  return { type: 'subs', request: { google: { skus: [offer.productId], subscriptionOffers: [{ sku: offer.productId, offerToken: offer.offerToken }],
    ...(previous?.purchaseToken ? { purchaseToken: previous.purchaseToken, subscriptionProductReplacementParams: { oldProductId: previous.productId, replacementMode: 'deferred' as const } } : {}) } } };
}

export async function connectPurchaseProof(purchase: Purchase, api: StoreApi, store = getConnectStore()): Promise<ConnectProof> {
  if (purchase.store !== store) throw new Error('The purchase belongs to a different store. Restore with the original store account.');
  if (purchase.purchaseState !== 'purchased') throw new Error('The store purchase is pending approval.');
  if (store === 'apple') {
    // purchaseToken is the exact JWS delivered by the native StoreKit API.
    const signedTransaction = purchase.purchaseToken || await api.getTransactionJwsIOS(purchase.productId);
    if (!signedTransaction) throw new Error('The native store did not return a signed transaction.');
    return { store, signedTransaction };
  }
  if (!purchase.purchaseToken) throw new Error('The native store did not return a purchase token.');
  return { store, purchaseToken: purchase.purchaseToken };
}

export type ConnectStoreApi = StoreApi;

export function parseBillingPeriod(value: string) {
  const match = /^P(\d+)([DWMY])$/.exec(value);
  return match ? { value: Number(match[1]), unit: ({ D: 'day', W: 'week', M: 'month', Y: 'year' } as Record<string, string>)[match[2]] } : undefined;
}
