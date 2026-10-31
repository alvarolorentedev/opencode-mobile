import { hasConnectEntitlement, normalizeTrustedControlPlaneUrl, parseConnectPairing, type ConnectPairing, type ConnectSession, type ConnectStore } from '@/shared/contracts/cloud-link';
import { savePendingConnectPairing } from '@/shared/storage/cloud-link';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { ConnectPhase } from '@/features/cloud-link/state/connect/catalog';

type PairingLink = Parameters<typeof parseConnectPairing>[0];

export function selectConnectControlPlane({
  url,
  enabled,
  isHydrated,
  phase,
  controlPlaneUrl,
  linkLock,
  lock,
  pendingClaim,
  pendingPurchase,
  changeControlPlane,
  setError,
}: {
  url: string;
  enabled: boolean;
  isHydrated: boolean;
  phase: ConnectPhase;
  controlPlaneUrl: string;
  linkLock: { current: boolean };
  lock: { current: boolean };
  pendingClaim: { current: unknown };
  pendingPurchase: { current: { session?: unknown } | undefined };
  changeControlPlane: (next: string) => void;
  setError: (error: string | undefined) => void;
}) {
  if (!enabled || !isHydrated || linkLock.current || lock.current || pendingClaim.current || pendingPurchase.current?.session || phase === 'purchasing' || phase === 'pending') return false;
  try {
    const next = normalizeTrustedControlPlaneUrl(url);
    if (next === controlPlaneUrl) return next;
    changeControlPlane(next);
    return next;
  } catch (reason) { setError((reason as Error).message); return false; }
}

export async function acceptConnectLink({
  link,
  controlPlaneUrl,
  store,
  pendingClaim,
  sessionRef,
  pairingRef,
  setPairing,
  setSavedProfile,
  setPhase,
  setError,
  setNotice,
}: {
  link: PairingLink;
  controlPlaneUrl: string;
  store: ConnectStore;
  pendingClaim: { current: unknown };
  sessionRef: { current: ConnectSession | undefined };
  pairingRef: { current: ConnectPairing | undefined };
  setPairing: (pairing: ConnectPairing | undefined) => void;
  setSavedProfile: (profile: ConnectionProfile | undefined) => void;
  setPhase: (phase: ConnectPhase) => void;
  setError: (error: string | undefined) => void;
  setNotice: (notice: string | undefined) => void;
}) {
  if (pendingClaim.current) { setError('Finish saving the claimed connection before opening another pairing.'); return false; }
  try {
    const next = parseConnectPairing(link);
    if (hasConnectEntitlement(sessionRef.current) && next.controlPlaneUrl !== controlPlaneUrl) throw new Error('This QR is for a different subscription environment. Open a fresh QR from the matching connector.');
    await savePendingConnectPairing(next.controlPlaneUrl, store, next);
    pairingRef.current = next; setPairing(next); setSavedProfile(undefined);
    setPhase('idle'); setError(undefined); setNotice(undefined);
    return true;
  } catch (reason) { setError((reason as Error).message); return false; }
}

export async function pairConnectLink({
  link,
  initialization,
  linkLock,
  autoPair,
  lock,
  pendingClaim,
  pendingPurchase,
  acceptLink,
}: {
  link: PairingLink;
  initialization: 'loading' | 'ready' | 'error';
  linkLock: { current: boolean };
  autoPair: { current: boolean };
  lock: { current: boolean };
  pendingClaim: { current: unknown };
  pendingPurchase: { current: unknown };
  acceptLink: (link: PairingLink) => Promise<boolean>;
}) {
  if (linkLock.current || pendingClaim.current || pendingPurchase.current || (lock.current && initialization !== 'loading')) return false;
  linkLock.current = true;
  autoPair.current = true;
  try {
    const accepted = await acceptLink(link);
    if (!accepted) autoPair.current = false;
    return accepted;
  } finally { linkLock.current = false; }
}
