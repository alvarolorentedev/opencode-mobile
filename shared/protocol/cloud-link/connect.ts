
import { fetch as expoFetch } from 'expo/fetch';

import { ConnectPairing, ConnectClaim, ConnectMachine, ConnectCatalog, ConnectSession, ConnectProof, parseConnectSession, hasConnectEntitlement, parseConnectClaim , requireControlPlane } from '@/shared/contracts/cloud-link';

export class ConnectApiError extends Error {
  public machineId?: string;
  public invalidPairingToken: boolean;
  public pairingExpired: boolean;
  public testPurchase: boolean;
  public noActiveSubscription: boolean;
  constructor(public status: number, value?: unknown) {
    super({
      400: 'Invalid subscription proof or request. Restore to recover your purchase.',
      401: 'Cloud Link session is invalid. Recover or restore access and try again.',
      403: 'Cloud Link access was denied. Try again or check your subscription.',
      404: 'Unknown pairing or machine. Open a fresh link from the connector.',
      409: 'This pairing expired, was already claimed, or is being provisioned. Retry or scan a fresh QR.',
      429: 'Too many requests. Wait before trying again.',
      502: 'Store or machine provisioning is temporarily unavailable. Retry without purchasing again.',
      503: 'Cloud Link configuration or access reconciliation is unavailable. Try again later.',
    }[status] ?? 'The control plane could not complete the request. Try again.');
    const record = value as { machine_id?: unknown; error?: unknown; code?: unknown } | undefined;
    this.testPurchase = status === 403 && record?.error === 'Google test purchases are disabled in this environment';
    this.noActiveSubscription = status === 403 && record?.error === 'no active subscription';
    if (this.noActiveSubscription) this.message = 'No active Cloud Link entitlement. Purchase or restore to recover access.';
    if (status === 403 && record?.code === 'capacity_reached') this.message = 'Cloud Link machine provisioning is pending or capacity has been reached. Wait for cleanup, then scan a fresh desktop QR. Your subscription has not been rejected.';
    if ((status === 409 || status === 503) && typeof record?.machine_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(record.machine_id)) this.machineId = record.machine_id;
    this.pairingExpired = status === 409 && record?.error === 'pairing expired';
    this.invalidPairingToken = status === 401 && record?.error === 'invalid pairing token';
    if (this.invalidPairingToken) this.message = 'Invalid pairing token. Scan a fresh connector QR.';
  }
}

async function connectRequest(controlPlaneUrl: string, path: string, token?: string, method = 'GET', body?: object, signal?: AbortSignal) {
  const base = requireControlPlane(controlPlaneUrl);
  if (token !== undefined && !token.trim()) throw new ConnectApiError(401);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    let response: Response;
    try {
      response = await expoFetch(`${base}${path}`, {
        method, signal: controller.signal, redirect: 'error',
        headers: { ...(token ? { Authorization: `Bearer ${token.trim()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error('Could not reach the control plane. Retry the same request without purchasing again.'); }
    if (response.status === 204) return undefined;
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('Invalid control plane response. Retry to recover the completed request.'); }
    if (!response.ok) throw new ConnectApiError(response.status, value);
    return value;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const subscriptionClaims = new Map<string, Promise<ConnectSession>>();

export async function getConnectCatalog(controlPlaneUrl: string, signal?: AbortSignal): Promise<ConnectCatalog> {
  const value = await connectRequest(controlPlaneUrl, '/v1/subscriptions/catalog', undefined, 'GET', undefined, signal) as ConnectCatalog | undefined;
  if (!value || !Array.isArray(value.plans) || !value.plans.length) throw new Error('Cloud Link subscription catalog is unavailable.');
  const identities = new Set<string>();
  return { plans: value.plans.map((plan) => {
    if (!plan || typeof plan.id !== 'string' || !plan.id.trim() || !Array.isArray(plan.entitlements) || !plan.entitlements.every((entry) => typeof entry === 'string') || !Array.isArray(plan.products)) throw new Error('Invalid subscription catalog.');
    return { id: plan.id, entitlements: [...plan.entitlements], products: plan.products.map((product) => {
      if (!product || typeof product.productId !== 'string' || !product.productId.trim() || !['apple', 'google'].includes(product.store)) throw new Error('Invalid subscription catalog.');
      if (product.store === 'google' && (typeof product.basePlanId !== 'string' || !product.basePlanId.trim() || !Array.isArray(product.offerIds) || !product.offerIds.every((id) => typeof id === 'string' && id.trim()))) throw new Error('Invalid subscription catalog.');
      const identity = `${product.store}:${product.productId}:${product.store === 'google' ? product.basePlanId : ''}`;
      if (identities.has(identity)) throw new Error('Ambiguous subscription catalog.');
      identities.add(identity);
      return product.store === 'apple' ? { store: 'apple', productId: product.productId } : { store: 'google', productId: product.productId, basePlanId: product.basePlanId, offerIds: [...product.offerIds] };
    }) };
  }) };
}
export async function claimConnectSubscription(controlPlaneUrl: string, proof: ConnectProof) {
  const base = requireControlPlane(controlPlaneUrl);
  // Share only concurrent verification. Never cache a granted session or failed proof.
  const key = JSON.stringify([base, proof.store, proof.store === 'apple' ? proof.signedTransaction : proof.purchaseToken]);
  let pending = subscriptionClaims.get(key);
  if (!pending) {
    pending = verifyConnectSubscription(base, proof).finally(() => subscriptionClaims.delete(key));
    subscriptionClaims.set(key, pending);
  }
  const session = await pending;
  return { ...session, entitlements: [...session.entitlements] };
}

async function verifyConnectSubscription(controlPlaneUrl: string, proof: ConnectProof) {
  const response = parseConnectSession(await connectRequest(controlPlaneUrl, '/v1/subscriptions/claim', undefined, 'POST', proof));
  if (!hasConnectEntitlement(response)) throw new Error('The store purchase has no active Cloud Link entitlement.');
  return response;
}

export async function claimConnectPairing(pairing: ConnectPairing, token: string, deviceName: string): Promise<ConnectClaim> {
  if (!deviceName.trim()) throw new Error('Enter a device name.');
  // The session authenticates the owner; the required QR token proves pairing intent.
  const value = await connectRequest(pairing.controlPlaneUrl, `/v1/pairings/${encodeURIComponent(pairing.pairingId)}/claim`, token, 'POST', { pairing_token: pairing.pairingToken, device_name: deviceName.trim() });
  return parseConnectClaim(pairing.controlPlaneUrl, value);
}

export async function listConnectMachines(controlPlaneUrl: string, token: string, signal?: AbortSignal): Promise<ConnectMachine[]> {
  const value = await connectRequest(controlPlaneUrl, '/v1/machines', token, 'GET', undefined, signal) as { machines?: unknown } | undefined;
  if (!Array.isArray(value?.machines)) throw new Error('Invalid machine list response.');
  const fields = ['id', 'name', 'hostname', 'public_url', 'created_at'] as const;
  return value.machines.map((entry) => {
    if (!entry || fields.some((key) => typeof entry[key] !== 'string') || typeof entry.access_enabled !== 'boolean') throw new Error('Invalid machine list response.');
    return { ...Object.fromEntries(fields.map((key) => [key, entry[key]])), access_enabled: entry.access_enabled } as ConnectMachine;
  });
}
export async function revokeConnectMachine(controlPlaneUrl: string, machineId: string, token: string) {
  await connectRequest(controlPlaneUrl, `/v1/machines/${encodeURIComponent(machineId)}`, token, 'DELETE');
}

export async function accessConnectMachine(controlPlaneUrl: string, machineId: string, token: string): Promise<ConnectClaim> {
  const value = await connectRequest(controlPlaneUrl, `/v1/machines/${encodeURIComponent(machineId)}/access`, token, 'POST');
  const result = parseConnectClaim(controlPlaneUrl, value);
  if (result.machine_id !== machineId) throw new Error('machine_identity_mismatch: Access returned a different machine.');
  return result;
}
