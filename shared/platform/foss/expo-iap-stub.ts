const unavailable = () => {
  throw new Error('Cloud Link is not available in this build.');
};

export const initConnection = unavailable;
export const endConnection = unavailable;
export const fetchProducts = unavailable;
export const requestPurchase = unavailable;
export const getAvailablePurchases = unavailable;
export const restorePurchases = unavailable;
export const finishTransaction = unavailable;
export const getTransactionJwsIOS = unavailable;
export const isEligibleForIntroOfferIOS = unavailable;
export const getPendingTransactionsIOS = unavailable;
export const purchaseUpdatedListener = () => ({ remove: () => undefined });
export const purchaseErrorListener = () => ({ remove: () => undefined });
