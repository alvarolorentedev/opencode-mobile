import type { Purchase } from 'expo-iap';
import { Platform } from 'react-native';

import { accessConnectMachine, claimConnectPairing, ConnectApiError } from '@/shared/protocol/cloud-link/connect';
import { getConnectCredentialError, hasConnectSession, isConnectEntitlement, type ConnectClaim, type ConnectPairing, type ConnectSession, type ConnectStore } from '@/shared/contracts/cloud-link';
import { getConnectSession, saveConnectSession } from '@/shared/storage/cloud-link';
import { getProfilePassword, loadConnectionProfiles, saveConnectProfile } from '@/shared/storage/connection-profiles';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ConnectionState } from '@/shared/contracts/domain';
import { ConnectPurchaseEnvironmentChange, type PendingConnectPurchase } from '@/features/cloud-link/services/connect-subscription-service';
import type { ConnectPhase } from '@/features/cloud-link/state/connect/catalog';
import { activateConnectProfile, type ConnectActivation } from '@/features/cloud-link/state/connect/activation';
export { activateConnectProfile } from '@/features/cloud-link/state/connect/activation';

export type PendingAccess = { controlPlaneUrl: string; response: ConnectClaim; previous?: ConnectionProfile; fromPairing?: boolean };

export type AccessDeps = {
  activation: { current: ConnectActivation | undefined };
  isActiveProfile: (profile: ConnectionProfile) => boolean;
  controlPlaneUrl: string;
  store: ConnectStore;
  sessionRef: { current: ConnectSession | undefined };
  pairingRef: { current: ConnectPairing | undefined };
  pendingClaim: { current: PendingAccess | undefined };
  pendingPurchase: { current: PendingConnectPurchase | undefined };
  entitlementRecovery: { current: boolean };
  recoveryMachineId: { current: string | undefined };
  lastAccess: { current: Map<string, number> };
  accessRequests: { current: Map<string, Promise<ConnectionProfile>> };
  setSession: (session: ConnectSession | undefined) => void;
  setPhase: (phase: ConnectPhase) => void;
  setProfiles: (profiles: ConnectionProfile[]) => void;
  setSavedProfile: (profile: ConnectionProfile | undefined) => void;
  switchConnection: (
    next: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username' | 'password' | 'connect'>,
    modelPreferences?: Partial<ChatPreferences>,
  ) => Promise<ConnectionState>;
  beforeProfileRefresh: () => Promise<void>;
  migrateConnectConnectionScope: (previous: ConnectionProfile, next: ConnectionProfile) => Promise<(() => Promise<void>) | undefined>;
  onProfileRefreshed: (previous: ConnectionProfile, next: ConnectionProfile) => void;
  clearPairing: () => Promise<void>;
  finishPurchase: (purchase: Purchase) => Promise<boolean>;
  recoverSession: () => Promise<ConnectSession>;
  waitForInitialization: () => Promise<void>;
};

export async function authenticateConnectRequest<T>({
  controlPlaneUrl,
  store,
  sessionRef,
  pendingPurchase,
  entitlementRecovery,
  setSession,
  finishPurchase,
  recoverSession,
}: AccessDeps, request: (token: string) => Promise<T>): Promise<T> {
  const invalidateEntitlement = async () => {
    const saved = sessionRef.current;
    if (!saved) return;
    const inactive = { ...saved, entitlements: saved.entitlements.filter((entry) => !isConnectEntitlement(entry)) };
    sessionRef.current = inactive;
    setSession(inactive);
    await saveConnectSession(controlPlaneUrl, store, inactive);
  };
  if (pendingPurchase.current) await finishPurchase(pendingPurchase.current.purchase);
  let current = sessionRef.current ?? await getConnectSession(controlPlaneUrl, store);
  if (!hasConnectSession(current)) current = await recoverSession();
  sessionRef.current = current;
  setSession(current);
  try {
    const result = await request(current!.user_token);
    entitlementRecovery.current = false;
    return result;
  }
  catch (reason) {
    if (!(reason instanceof ConnectApiError) || reason.invalidPairingToken || (reason.status !== 401 && !reason.noActiveSubscription)) throw reason;
    if (reason.noActiveSubscription) await invalidateEntitlement();
    if (reason.noActiveSubscription && entitlementRecovery.current) {
      entitlementRecovery.current = false;
      throw reason;
    }
    entitlementRecovery.current = reason.noActiveSubscription;
    let changingEnvironment = false;
    try {
      const recovered = await recoverSession();
      return await request(recovered.user_token);
    }
    catch (retryReason) {
      changingEnvironment = retryReason instanceof ConnectPurchaseEnvironmentChange;
      if (retryReason instanceof ConnectApiError && retryReason.noActiveSubscription) await invalidateEntitlement();
      throw retryReason;
    }
    finally {
      if (!changingEnvironment) entitlementRecovery.current = false;
    }
  }
}

export async function saveConnectAccess({
  pendingClaim,
  migrateConnectConnectionScope,
  setPhase,
  onProfileRefreshed,
  clearPairing,
  setProfiles,
  setSavedProfile,
  lastAccess,
}: AccessDeps) {
  const pending = pendingClaim.current;
  if (!pending) throw new Error('No connection is waiting to be saved.');
  setPhase('saving');
  let rollbackScope: (() => Promise<void>) | undefined;
  if (pending.previous) {
    const next = { ...pending.previous, serverUrl: pending.response.server_url, username: pending.response.device_id };
    if (new URL(next.serverUrl).hostname !== new URL(pending.previous.serverUrl).hostname) throw new Error('machine_hostname_mismatch: Access returned a different hostname.');
    rollbackScope = await migrateConnectConnectionScope(pending.previous, next);
  }
  let profile: ConnectionProfile;
  try { profile = await saveConnectProfile(pending.controlPlaneUrl, pending.response); }
  catch { await rollbackScope?.(); throw new Error('Access succeeded, but secure saving failed. Retry saving without claiming or purchasing again.'); }
  if (pending.previous) onProfileRefreshed(pending.previous, profile);
  if (pending.fromPairing) await clearPairing();
  pendingClaim.current = undefined;
  setProfiles(await loadConnectionProfiles());
  setSavedProfile(profile);
  lastAccess.current.set(profile.connect!.machineId, Date.now());
  return profile;
}

export function requestConnectAccess(deps: AccessDeps, machineId: string, fromPairing = false): Promise<ConnectionProfile> {
  const { controlPlaneUrl, recoveryMachineId, beforeProfileRefresh, pendingClaim, accessRequests } = deps;
  const key = `${controlPlaneUrl}:${machineId}`;
  const existing = accessRequests.current.get(key);
  if (existing) return fromPairing ? existing.then(async (profile) => { await deps.clearPairing(); return profile; }) : existing;
  // The secure-save checkpoint is shared, so different machines save in order.
  const preceding = [...accessRequests.current.values()];
  const request = (async () => {
    await Promise.allSettled(preceding);
    recoveryMachineId.current = machineId;
    if (pendingClaim.current) {
      if (pendingClaim.current.controlPlaneUrl !== controlPlaneUrl || pendingClaim.current.response.machine_id !== machineId) throw new Error('Finish saving the pending machine before reconnecting another machine.');
    } else {
      await beforeProfileRefresh();
      const previous = (await loadConnectionProfiles(true)).find((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === machineId);
      const response = await authenticateConnectRequest(deps, (token) => accessConnectMachine(controlPlaneUrl, machineId, token));
      if (previous && new URL(previous.serverUrl).hostname !== new URL(response.server_url).hostname) throw new Error('machine_hostname_mismatch: Access returned a different hostname.');
      pendingClaim.current = { controlPlaneUrl, response, previous, fromPairing };
    }
    const saved = await saveConnectAccess(deps);
    recoveryMachineId.current = undefined;
    deps.setPhase('idle');
    return saved;
  })().finally(() => { accessRequests.current.delete(key); });
  accessRequests.current.set(key, request);
  return request;
}

export async function prepareConnectSettings(deps: AccessDeps, settings: OpencodeConnectionSettings): Promise<OpencodeConnectionSettings> {
  const { controlPlaneUrl, pendingPurchase, pendingClaim, lastAccess } = deps;
  if (!settings.connect) return settings;
  let initialized = false;
  while (true) {
    const profile = (await loadConnectionProfiles(true)).find((entry) => entry.connect?.machineId === settings.connect!.machineId && entry.connect.controlPlaneUrl === settings.connect!.controlPlaneUrl);
    const password = profile ? await getProfilePassword(profile.id) : settings.password;
    const connect = profile?.connect ?? settings.connect;
    const credentialError = getConnectCredentialError(connect, password);
    const activating = deps.activation.current?.startup && deps.activation.current.profile.connect?.machineId === connect.machineId && deps.activation.current.profile.connect.controlPlaneUrl === connect.controlPlaneUrl;
    if (activating && credentialError) throw new Error(credentialError);
    const refresh = credentialError || (!activating && Date.parse(connect.expiresAt) - Date.now() <= 5 * 60_000 && Date.now() - (lastAccess.current.get(connect.machineId) ?? 0) > 60_000);
    if (!initialized && (pendingPurchase.current || refresh)) {
      await deps.waitForInitialization();
      initialized = true;
      continue;
    }
    if (pendingPurchase.current) throw new Error('Finish securing and finalizing your subscription before reconnecting.');
    if (refresh) {
      if (connect.controlPlaneUrl !== controlPlaneUrl) throw new Error('Select this machine’s trusted Cloud Link environment to recover access.');
      if (pendingClaim.current && pendingClaim.current.response.machine_id !== connect.machineId) throw new Error('Finish saving the pending machine before reconnecting another machine.');
      const next = await requestConnectAccess(deps, connect.machineId);
      return { ...settings, serverUrl: next.serverUrl, username: next.username, password: await getProfilePassword(next.id), connect: next.connect };
    }
    return { ...settings, serverUrl: profile?.serverUrl ?? settings.serverUrl, username: profile?.username ?? settings.username, password, connect };
  }
}

export async function claimConnectAction(deps: AccessDeps, isCurrent = () => true) {
  const { controlPlaneUrl, pairingRef, pendingClaim, pendingPurchase, finishPurchase, setPhase, clearPairing } = deps;
  await Promise.allSettled([...deps.accessRequests.current.values()]);
  if (pendingClaim.current) {
    const fromPairing = pendingClaim.current.fromPairing;
    return activateConnectProfile(deps, await requestConnectAccess(deps, pendingClaim.current.response.machine_id), fromPairing, isCurrent);
  }
  const current = pairingRef.current;
  if (!current) throw new Error('Scan or open a pairing link first.');
  if (current.controlPlaneUrl !== controlPlaneUrl) throw new Error('This QR is for a different subscription environment. Open a fresh QR from the matching connector.');
  if (pendingPurchase.current) await finishPurchase(pendingPurchase.current.purchase);
  setPhase('claiming');
  let response: ConnectClaim;
  try {
    const deviceName = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web test device';
    response = await authenticateConnectRequest(deps, (token) => claimConnectPairing(current, token, deviceName));
  } catch (reason) {
    if (reason instanceof ConnectApiError && reason.machineId) return activateConnectProfile(deps, await requestConnectAccess(deps, reason.machineId, true), true, isCurrent);
    if (reason instanceof ConnectApiError && (reason.status === 404 || reason.invalidPairingToken || reason.pairingExpired)) await clearPairing();
    throw reason;
  }
  const previous = (await loadConnectionProfiles(true)).find((profile) => profile.connect?.controlPlaneUrl === current.controlPlaneUrl && profile.connect.machineId === response.machine_id);
  pendingClaim.current = { controlPlaneUrl: current.controlPlaneUrl, response, previous, fromPairing: true };
  return activateConnectProfile(deps, await requestConnectAccess(deps, response.machine_id, true), true, isCurrent);
}
