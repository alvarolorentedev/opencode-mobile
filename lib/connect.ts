import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type ConnectMetadata = {
  controlPlaneUrl: string;
  machineId: string;
  machineName: string;
  deviceId: string;
  expiresAt: string;
};
export type ConnectPairing = { controlPlaneUrl: string; pairingId: string; pairingToken: string; machineName: string };
export type ConnectClaim = { server_url: string; machine_id: string; machine_name: string; device_id: string; device_secret: string; expires_at: string };
export type ConnectMachine = { id: string; name: string; hostname: string; public_url: string; created_at: string; access_enabled: boolean };
export type ConnectStore = 'apple' | 'google';
export type ConnectProduct = { store: 'apple'; productId: string } | { store: 'google'; productId: string; basePlanId: string; offerIds: string[] };
export type ConnectCatalog = { plans: { id: string; entitlements: string[]; products: ConnectProduct[] }[] };
export type ConnectSession = { user_id: string; user_token: string; session_expires_at: string; subscription_expires_at: string; entitlements: string[] };
export type ConnectProof = { store: 'apple'; signedTransaction: string } | { store: 'google'; purchaseToken: string };
export const CONNECT_PRODUCTION_URL = 'https://api.opencodecloud.link';
export const CONNECT_STAGING_URL = 'https://apistaging.opencodecloud.link';
export const CONNECT_LEARN_MORE_URL = 'https://opencodecloud.link/';

export function isConnectEnabled() {
  const extra = Constants.expoConfig?.extra;
  if (extra?.foss) return false;
  return Platform.OS === 'ios' || Platform.OS === 'android' || (extra?.e2eMode === true && extra?.connectPilot?.testing === true);
}

export function normalizeControlPlaneUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTPS control plane URL without credentials, query parameters, or a fragment.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function getConnectControlPlanes(): string[] {
  return [CONNECT_PRODUCTION_URL, CONNECT_STAGING_URL];
}

export function normalizeTrustedControlPlaneUrl(value: string) {
  const url = normalizeControlPlaneUrl(value);
  if (!getConnectControlPlanes().includes(url)) throw new Error('This pairing does not match a trusted control plane. Open a fresh QR from the connector.');
  return url;
}

function requireControlPlane(value: string) {
  if (!isConnectEnabled()) throw new Error('Cloud Link is available on iOS and Android.');
  return normalizeTrustedControlPlaneUrl(value);
}

export function parseConnectPairing(value: string | Record<string, string | string[] | undefined>, controlPlaneUrl?: string): ConnectPairing {
  try {
    const url = new URL(typeof value === 'string' ? value : 'opencodemobile://pair');
    if (typeof value !== 'string') {
      for (const [key, entries] of Object.entries(value)) for (const entry of Array.isArray(entries) ? entries : entries === undefined ? [] : [entries]) url.searchParams.append(key, entry);
    }
    if (url.protocol !== 'opencodemobile:' || url.hostname !== 'pair' || (url.pathname && url.pathname !== '/') || url.hash || url.username || url.password) throw new Error();
    const fields = ['v', 'cp', 'id', 't', 'n'];
    if (fields.some((field) => url.searchParams.getAll(field).length !== 1 || !url.searchParams.get(field)?.trim())) throw new Error();
    if (url.searchParams.get('v') !== '1') throw new Error();
    const pairingId = url.searchParams.get('id')!;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(pairingId)) throw new Error();
    const pairingControlPlane = requireControlPlane(url.searchParams.get('cp')!);
    if (controlPlaneUrl && pairingControlPlane !== normalizeTrustedControlPlaneUrl(controlPlaneUrl)) throw new Error('This pairing does not match the subscription environment. Open a fresh QR from the matching connector.');
    return {
      controlPlaneUrl: pairingControlPlane,
      pairingId,
      pairingToken: url.searchParams.get('t')!,
      machineName: url.searchParams.get('n')!,
    };
  } catch (error) {
    if (error instanceof Error && /trusted|subscription environment|iOS and Android/.test(error.message)) throw error;
    throw new Error('Invalid or unsupported pairing link. Open a fresh link from the connector.');
  }
}

export function parseConnectMetadata(value: unknown): ConnectMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const keys = ['controlPlaneUrl', 'machineId', 'machineName', 'deviceId', 'expiresAt'] as const;
  if (keys.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())) return undefined;
  try {
    const result = Object.fromEntries(keys.map((key) => [key, (record[key] as string).trim()])) as ConnectMetadata;
    result.controlPlaneUrl = normalizeControlPlaneUrl(result.controlPlaneUrl);
    if (!Number.isFinite(Date.parse(result.expiresAt))) return undefined;
    return result;
  } catch { return undefined; }
}

export function getConnectCredentialError(connect: ConnectMetadata | undefined, password: string, now = Date.now()) {
  if (!connect) return undefined;
  if (!parseConnectMetadata(connect)) return 'Invalid Cloud Link profile. Pair this device again.';
  try { requireControlPlane(connect.controlPlaneUrl); } catch (error) { return (error as Error).message; }
  if (Date.parse(connect.expiresAt) <= now) return 'Cloud Link credentials expired. Restore or renew access to reconnect.';
  if (!password) return 'Cloud Link credentials are missing. Recover machine access to reconnect.';
  return undefined;
}

// Web credentials exist only in the explicit development E2E build and vanish
// on reload. Product web builds continue to have no credential persistence.
const testSecrets = new Map<string, string>();
export function getConnectTestSecret(key: string) {
  return isConnectEnabled() && Platform.OS === 'web' ? testSecrets.get(key) ?? '' : '';
}
export function setConnectTestSecret(key: string, value: string) {
  if (isConnectEnabled() && Platform.OS === 'web') {
    const fixture = globalThis as typeof globalThis & { __connectSecureWriteFailure?: boolean };
    if (fixture.__connectSecureWriteFailure && key.includes('connect-session')) { fixture.__connectSecureWriteFailure = false; throw new Error('Secure storage unavailable.'); }
    if (value) testSecrets.set(key, value); else testSecrets.delete(key);
  }
}

export function getConnectStore(): ConnectStore {
  return Platform.OS === 'ios' ? 'apple' : 'google';
}

function secureKey(controlPlaneUrl: string, store: ConnectStore, kind: string) {
  const segment = Array.from(requireControlPlane(controlPlaneUrl)).map((char) => char.charCodeAt(0).toString(16)).join('-');
  return `opencode-mobile.connect-${kind}.${store}.${segment}`;
}
async function readSecret(key: string) {
  return Platform.OS === 'web' ? getConnectTestSecret(key) : await SecureStore.getItemAsync(key) ?? '';
}
async function writeSecret(key: string, value: string) {
  if (Platform.OS === 'web') { setConnectTestSecret(key, value); return; }
  if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}
export function parseConnectSession(value: unknown): ConnectSession {
  const record = value as ConnectSession | undefined;
  if (!record || ['user_id', 'user_token', 'session_expires_at', 'subscription_expires_at'].some((key) => typeof (record as unknown as Record<string, unknown>)[key] !== 'string' || !(record as unknown as Record<string, string>)[key].trim()) ||
      !Number.isFinite(Date.parse(record.session_expires_at)) || !Number.isFinite(Date.parse(record.subscription_expires_at)) ||
      !Array.isArray(record.entitlements) || !record.entitlements.every((entry) => typeof entry === 'string')) throw new Error('Invalid subscription session response.');
  return { user_id: record.user_id, user_token: record.user_token, session_expires_at: record.session_expires_at, subscription_expires_at: record.subscription_expires_at, entitlements: [...record.entitlements] };
}
export async function getConnectSession(controlPlaneUrl: string, store: ConnectStore) {
  const raw = await readSecret(secureKey(controlPlaneUrl, store, 'session'));
  if (!raw) return undefined;
  try { return parseConnectSession(JSON.parse(raw)); } catch { await writeSecret(secureKey(controlPlaneUrl, store, 'session'), ''); return undefined; }
}
export async function saveConnectSession(controlPlaneUrl: string, store: ConnectStore, session: ConnectSession) {
  await writeSecret(secureKey(controlPlaneUrl, store, 'session'), JSON.stringify(parseConnectSession(session)));
}
export function hasConnectSession(session: ConnectSession | undefined, now = Date.now()) {
  return Boolean(session && Date.parse(session.session_expires_at) > now);
}
export function isConnectEntitlement(entitlement: string) {
  return entitlement === 'cloudlink' || entitlement === 'connect';
}
export function hasConnectEntitlement(session: ConnectSession | undefined, now = Date.now()) {
  return Boolean(hasConnectSession(session, now) && session?.entitlements.some(isConnectEntitlement) && Date.parse(session.subscription_expires_at) > now);
}
export async function savePendingConnectPairing(controlPlaneUrl: string, store: ConnectStore, pairing?: ConnectPairing) {
  await writeSecret(secureKey(controlPlaneUrl, store, 'pairing'), pairing ? JSON.stringify(pairing) : '');
}
export async function getPendingConnectPairing(controlPlaneUrl: string, store: ConnectStore) {
  const raw = await readSecret(secureKey(controlPlaneUrl, store, 'pairing'));
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as ConnectPairing;
    const result = parseConnectPairing({ v: '1', cp: value.controlPlaneUrl, id: value.pairingId, t: value.pairingToken, n: value.machineName }, controlPlaneUrl);
    if (result.controlPlaneUrl !== requireControlPlane(controlPlaneUrl)) throw new Error();
    return result;
  } catch { await savePendingConnectPairing(controlPlaneUrl, store); return undefined; }
}

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

export function parseConnectClaim(controlPlaneUrl: string, value: unknown): ConnectClaim {
  const result = value as ConnectClaim | undefined;
  const fields = ['server_url', 'machine_id', 'machine_name', 'device_id', 'device_secret', 'expires_at'] as const;
  if (!result || fields.some((key) => typeof result[key] !== 'string' || !result[key].trim()) || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('Invalid pairing response. Create a new pairing.');
  let server: URL;
  try { server = new URL(result.server_url); } catch { throw new Error('The connector returned an unsafe server URL.'); }
  requireControlPlane(controlPlaneUrl);
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('The connector returned an unsafe server URL.');
  if (Date.parse(result.expires_at) <= Date.now()) throw new Error('The connector returned expired credentials. Pair again.');
  return Object.fromEntries(fields.map((key) => [key, result[key]])) as ConnectClaim;
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
