// FOSS builds exclude expo-store-review because it links Google Play Review.
// The Settings action is hidden by canRateApp(), so these are never used.
export async function isAvailableAsync() {
  return false;
}

export async function requestReview() {
  return undefined;
}

export function storeUrl() {
  return null;
}

export async function hasAction() {
  return false;
}
