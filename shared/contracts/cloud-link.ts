import Constants from 'expo-constants';

import { Platform } from 'react-native';

export type ConnectMetadata = {
  controlPlaneUrl: string;
  machineId: string;
  machineName: string;
  deviceId: string;
  expiresAt: string;
  renewAt?: string;
};

export type ConnectPairing = { controlPlaneUrl: string; pairingId: string; pairingToken: string; machineName: string };

export type ConnectActivationState = 'pending_approval' | 'tunnel_starting' | 'ready';

// Optional activation readiness from the control plane. Older services omit it
// entirely; a malformed value never invalidates the connection response.
export type ConnectActivation = {
  state: ConnectActivationState;
  retry_after_ms?: number;
  expires_at?: string;
  ready_at?: string;
};

// Pairing claims may omit the device credential; machine access always returns it.
export type ConnectClaim = { server_url: string; machine_id: string; machine_name: string; device_id?: string; device_secret?: string; expires_at?: string; activation?: ConnectActivation };

export type ConnectAccess = ConnectClaim & { device_id: string; device_secret: string; expires_at: string };

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

export function requireControlPlane(value: string) {
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
    // Scheduling metadata is optional and never invalidates an otherwise usable
    // profile. A target after expiry is ignored so renewal cannot miss the deadline.
    if (typeof record.renewAt === 'string' && Number.isFinite(Date.parse(record.renewAt)) && Date.parse(record.renewAt) <= Date.parse(result.expiresAt)) result.renewAt = record.renewAt;
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

// Schedule a renewal at one third of the credential lifetime, capped at 30 days
// with a five-minute floor. A 90-day credential therefore renews around day 60.
export function getConnectRenewalAt(expiresAt: string, now = Date.now()) {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  const lifetime = Math.max(0, expires - now);
  const lead = Math.min(30 * 86_400_000, Math.max(lifetime / 3, 5 * 60_000));
  return new Date(Math.max(now, expires - lead)).toISOString();
}

export function getConnectStore(): ConnectStore {
  return Platform.OS === 'ios' ? 'apple' : 'google';
}

export function parseConnectSession(value: unknown): ConnectSession {
  const record = value as ConnectSession | undefined;
  if (!record || ['user_id', 'user_token', 'session_expires_at', 'subscription_expires_at'].some((key) => typeof (record as unknown as Record<string, unknown>)[key] !== 'string' || !(record as unknown as Record<string, string>)[key].trim()) ||
      !Number.isFinite(Date.parse(record.session_expires_at)) || !Number.isFinite(Date.parse(record.subscription_expires_at)) ||
      !Array.isArray(record.entitlements) || !record.entitlements.every((entry) => typeof entry === 'string')) throw new Error('Invalid subscription session response.');
  return { user_id: record.user_id, user_token: record.user_token, session_expires_at: record.session_expires_at, subscription_expires_at: record.subscription_expires_at, entitlements: [...record.entitlements] };
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

export function parseConnectActivation(value: unknown): ConnectActivation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.state !== 'pending_approval' && record.state !== 'tunnel_starting' && record.state !== 'ready') return undefined;
  const activation: ConnectActivation = { state: record.state };
  if (record.retry_after_ms !== undefined) {
    if (typeof record.retry_after_ms !== 'number' || !Number.isFinite(record.retry_after_ms) || record.retry_after_ms < 0) return undefined;
    activation.retry_after_ms = Math.floor(record.retry_after_ms);
  }
  for (const key of ['expires_at', 'ready_at'] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key]))) return undefined;
    activation[key] = record[key] as string;
  }
  return activation;
}

export function hasConnectClaimCredential(claim: ConnectClaim): claim is ConnectAccess {
  return Boolean(claim.device_id && claim.device_secret && claim.expires_at);
}

function parseConnectConnection(controlPlaneUrl: string, value: unknown, requireCredential: boolean): ConnectClaim {
  const result = value as Record<string, unknown> | undefined;
  const fields = ['server_url', 'machine_id', 'machine_name'] as const;
  const invalid = requireCredential ? 'Invalid machine access response. Retry access.' : 'Invalid pairing response. Create a new pairing.';
  if (!result || fields.some((key) => typeof result[key] !== 'string' || !(result[key] as string).trim())) throw new Error(invalid);
  const serverUrl = result.server_url as string;
  let server: URL;
  try { server = new URL(serverUrl); } catch { throw new Error('The connector returned an unsafe server URL.'); }
  requireControlPlane(controlPlaneUrl);
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('The connector returned an unsafe server URL.');
  const activation = parseConnectActivation(result.activation);
  const hasSecret = typeof result.device_secret === 'string' && Boolean(result.device_secret.trim());
  if (requireCredential || hasSecret) {
    const credentialFields = ['device_id', 'device_secret', 'expires_at'] as const;
    if (credentialFields.some((key) => typeof result[key] !== 'string' || !(result[key] as string).trim()) || !Number.isFinite(Date.parse(result.expires_at as string))) throw new Error(invalid);
    if (Date.parse(result.expires_at as string) <= Date.now()) throw new Error(requireCredential ? 'The machine returned expired credentials. Retry access.' : 'The connector returned expired credentials. Pair again.');
  }
  const base = {
    server_url: serverUrl,
    machine_id: result.machine_id as string,
    machine_name: result.machine_name as string,
    ...(activation ? { activation } : {}),
  };
  if (!requireCredential && !hasSecret) return base;
  return { ...base, device_id: result.device_id as string, device_secret: result.device_secret as string, expires_at: result.expires_at as string };
}

export function parseConnectClaim(controlPlaneUrl: string, value: unknown): ConnectClaim {
  return parseConnectConnection(controlPlaneUrl, value, false);
}

export function parseConnectAccess(controlPlaneUrl: string, value: unknown): ConnectAccess {
  return parseConnectConnection(controlPlaneUrl, value, true) as ConnectAccess;
}
