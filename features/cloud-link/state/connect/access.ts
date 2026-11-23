import type { Purchase } from 'expo-iap';
import { Platform } from 'react-native';

import { accessConnectMachine, claimConnectPairing, ConnectApiError } from '@/shared/protocol/cloud-link/connect';
import { withSpan } from '@/shared/observability/client';
import { getConnectCredentialError, getConnectRenewalAt, hasConnectClaimCredential, hasConnectSession, isConnectEntitlement, type ConnectAccess, type ConnectClaim, type ConnectPairing, type ConnectSession, type ConnectStore } from '@/shared/contracts/cloud-link';
import { getConnectSession, saveConnectSession } from '@/shared/storage/cloud-link';
import { getProfilePassword, loadConnectionProfiles, saveConnectProfile } from '@/shared/storage/connection-profiles';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ConnectionState } from '@/features/connections/index';
import { ConnectPurchaseEnvironmentChange, type PendingConnectPurchase } from '@/features/cloud-link/services/connect-subscription-service';
import type { ConnectPhase } from '@/features/cloud-link/state/connect/catalog';
import { activateConnectProfile, type ActivationAuthenticate, type ConnectActivationAttempt, type ConnectActivationHint } from '@/features/cloud-link/state/connect/activation';
export { activateConnectProfile } from '@/features/cloud-link/state/connect/activation';

export type PendingAccess = { controlPlaneUrl: string; response: ConnectClaim; previous?: ConnectionProfile; fromPairing?: boolean; pairingId?: string };

export type AccessDeps = {
  activation: { current: ConnectActivationAttempt | undefined };
  activationHints: { current: Map<string, ConnectActivationHint> };
  activeMachineId: { current: string | undefined };
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

type EntitlementDeps = Pick<AccessDeps, 'controlPlaneUrl' | 'store' | 'sessionRef' | 'setSession'>;

async function clearConnectEntitlement({ controlPlaneUrl, store, sessionRef, setSession }: EntitlementDeps) {
  const saved = sessionRef.current;
  if (!saved) return;
  const inactive = { ...saved, entitlements: saved.entitlements.filter((entry) => !isConnectEntitlement(entry)) };
  sessionRef.current = inactive;
  setSession(inactive);
  await saveConnectSession(controlPlaneUrl, store, inactive);
}

const retryDelays = [1_000, 2_000] as const;

async function retryTransient<T>(run: () => Promise<T>, retryable: (reason: ConnectApiError) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await run(); }
    catch (reason) {
      if (!(reason instanceof ConnectApiError) || attempt >= retryDelays.length || !retryable(reason)) throw reason;
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}

const retryAccess = (reason: ConnectApiError) => reason.status === 503 || reason.status === 409;
// A machine-id 409/503 is a provisioning checkpoint with its own access
// recovery; replaying the claim would consume the QR again.
const retryClaim = (reason: ConnectApiError) => reason.status === 503
  ? !reason.machineId
  : reason.status === 409 && !reason.machineId && !reason.pairingExpired && !reason.invalidPairingToken && !reason.activationUnsupported;

async function recoverConnectAccess(deps: AccessDeps, machineId: string, invalidateEntitlement: boolean): Promise<ConnectAccess> {
  if (invalidateEntitlement) await clearConnectEntitlement(deps);
  const session = await deps.recoverSession();
  deps.sessionRef.current = session;
  deps.setSession(session);
  deps.entitlementRecovery.current = false;
  return accessConnectMachine(deps.controlPlaneUrl, machineId, { token: session.user_token });
}

async function renewConnectAccess(deps: AccessDeps, machineId: string, previous: ConnectionProfile | undefined, recoverEntitlement: boolean): Promise<ConnectAccess> {
  const password = previous ? await getProfilePassword(previous.id) : '';
  const credential = previous?.connect && password ? { deviceId: previous.connect.deviceId, deviceSecret: password } : undefined;
  // The stored expiry schedules renewal only. The server decides whether the
  // credential still authenticates, including after local clock skew.
  const basicFirst = Boolean(credential && previous?.connect && Date.parse(previous.connect.expiresAt) > Date.now());
  if (basicFirst && credential) {
    try {
      return await accessConnectMachine(deps.controlPlaneUrl, machineId, credential);
    } catch (reason) {
      if (!(reason instanceof ConnectApiError)) throw reason;
      // Never replay a rejected device credential. A valid session can still
      // recover access without a new store claim; otherwise verify the purchase.
      if (reason.status === 401) return recoverConnectAccess(deps, machineId, false);
      if (reason.status === 403) {
        if (reason.testPurchase || (reason.noActiveSubscription && !recoverEntitlement)) throw reason;
        return recoverConnectAccess(deps, machineId, reason.noActiveSubscription);
      }
      throw reason;
    }
  }
  try {
    return await authenticateConnectRequest(deps, async (token) => {
      try {
        return await accessConnectMachine(deps.controlPlaneUrl, machineId, { token });
      } catch (reason) {
        if (credential && reason instanceof ConnectApiError && reason.legacySessionStepUpRequired) return accessConnectMachine(deps.controlPlaneUrl, machineId, credential);
        throw reason;
      }
    }, { recoverEntitlement });
  } catch (reason) {
    // A web session cannot use the Bearer path, and an expired credential may no
    // longer step up. Verify the store once, then retry access with a mobile
    // session instead of looping on the rejected authorization.
    if (reason instanceof ConnectApiError && reason.status === 403 && !reason.noActiveSubscription && !reason.testPurchase) return recoverConnectAccess(deps, machineId, false);
    throw reason;
  }
}

export async function authenticateConnectRequest<T>({
  controlPlaneUrl,
  store,
  sessionRef,
  pendingPurchase,
  entitlementRecovery,
  setSession,
  finishPurchase,
  recoverSession,
}: AccessDeps, request: (token: string) => Promise<T>, options?: { recoverEntitlement?: boolean }): Promise<T> {
  const invalidateEntitlement = () => clearConnectEntitlement({ controlPlaneUrl, store, sessionRef, setSession });
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
    // A pre-expiry access check legitimately races the store renewal. Keep the
    // still-valid credential instead of clearing the entitlement and claiming.
    if (reason.noActiveSubscription && options?.recoverEntitlement === false) throw reason;
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

async function saveConnectAccess({
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
  if (!hasConnectClaimCredential(pending.response)) throw new Error('The machine did not return a device credential. Retry access.');
  const response = pending.response;
  setPhase('saving');
  const previous = pending.previous;
  const sameMachine = previous?.connect?.machineId === response.machine_id && previous.connect.controlPlaneUrl === pending.controlPlaneUrl;
  let rollbackScope: (() => Promise<void>) | undefined;
  if (previous && sameMachine) {
    const next = { ...previous, serverUrl: response.server_url, username: response.device_id };
    rollbackScope = await migrateConnectConnectionScope(previous, next);
  }
  let profile: ConnectionProfile;
  try { profile = await saveConnectProfile(pending.controlPlaneUrl, response, previous && !sameMachine ? previous : undefined); }
  catch { await rollbackScope?.(); throw new Error('Access succeeded, but secure saving failed. Retry saving without claiming or purchasing again.'); }
  if (previous) onProfileRefreshed(previous, profile);
  if (pending.fromPairing) await clearPairing();
  pendingClaim.current = undefined;
  setProfiles(await loadConnectionProfiles());
  setSavedProfile(profile);
  lastAccess.current.set(profile.connect!.machineId, Date.now());
  return profile;
}

export function requestConnectAccess(deps: AccessDeps, machineId: string, fromPairing = false, recoverEntitlement = true, hintActivation = false): Promise<ConnectionProfile> {
  const { controlPlaneUrl, recoveryMachineId, beforeProfileRefresh, pendingClaim, accessRequests } = deps;
  const key = `${controlPlaneUrl}:${machineId}`;
  const existing = accessRequests.current.get(key);
  if (existing) return fromPairing ? existing.then(async (profile) => { await deps.clearPairing(); return profile; }) : existing;
  // The secure-save checkpoint is shared, so different machines save in order.
  const preceding = [...accessRequests.current.values()];
  const request = withSpan('cloudlink.access', { source: fromPairing ? 'pairing' : 'renewal' }, async (span) => {
    await Promise.allSettled(preceding);
    recoveryMachineId.current = machineId;
    let previous: ConnectionProfile | undefined;
    let partial: PendingAccess | undefined;
    if (pendingClaim.current) {
      if (pendingClaim.current.controlPlaneUrl !== controlPlaneUrl || pendingClaim.current.response.machine_id !== machineId) throw new Error('Finish saving the pending machine before reconnecting another machine.');
      if (hasConnectClaimCredential(pendingClaim.current.response)) {
        const saved = await saveConnectAccess(deps);
        recoveryMachineId.current = undefined;
        deps.setPhase('idle');
        span.setAttribute('result', 'saved');
        return saved;
      }
      // A claim without a device credential is not a failure. Keep its
      // replacement checkpoint and recover the credential through access.
      partial = pendingClaim.current;
      previous = partial.previous;
      pendingClaim.current = undefined;
    }
    let response: ConnectAccess;
    try {
      await beforeProfileRefresh();
      if (!previous) previous = (await loadConnectionProfiles(true)).find((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === machineId);
      response = await retryTransient(() => renewConnectAccess(deps, machineId, previous, recoverEntitlement), retryAccess);
    } catch (reason) {
      // Keep the credentialless claim so an explicit retry resumes access
      // instead of redeeming the one-use QR again.
      if (partial) pendingClaim.current = partial;
      throw reason;
    }
    if (hintActivation && response.activation) deps.activationHints.current.set(response.machine_id, {
      activation: response.activation,
      ...(fromPairing && deps.pairingRef.current ? { pairingId: deps.pairingRef.current.pairingId } : {}),
    });
    pendingClaim.current = { controlPlaneUrl, response, previous, fromPairing, ...(fromPairing && deps.pairingRef.current ? { pairingId: deps.pairingRef.current.pairingId } : {}) };
    const saved = await saveConnectAccess(deps);
    recoveryMachineId.current = undefined;
    deps.setPhase('idle');
    span.setAttribute('result', 'saved');
    return saved;
  }).finally(() => { accessRequests.current.delete(key); });
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
    const storedRenewAt = connect.renewAt ? Date.parse(connect.renewAt) : NaN;
    const renewAt = Number.isFinite(storedRenewAt) ? storedRenewAt : Date.parse(getConnectRenewalAt(connect.expiresAt) ?? connect.expiresAt);
    const refresh = credentialError || (!activating && renewAt <= Date.now() && Date.now() - (lastAccess.current.get(connect.machineId) ?? 0) > 60_000);
    if (!initialized && (pendingPurchase.current || refresh)) {
      await deps.waitForInitialization();
      initialized = true;
      continue;
    }
    if (pendingPurchase.current) throw new Error('Finish securing and finalizing your subscription before reconnecting.');
    if (refresh) {
      if (connect.controlPlaneUrl !== controlPlaneUrl) throw new Error('Select this machine’s trusted Cloud Link environment to recover access.');
      if (pendingClaim.current && pendingClaim.current.response.machine_id !== connect.machineId) throw new Error('Finish saving the pending machine before reconnecting another machine.');
      try {
        const next = await requestConnectAccess(deps, connect.machineId, false, Boolean(credentialError));
        return { ...settings, serverUrl: next.serverUrl, username: next.username, password: await getProfilePassword(next.id), connect: next.connect };
      } catch (reason) {
        // A best-effort renewal must not break a still-valid connection: the old
        // credential can keep working until it actually expires. A purchase
        // environment change must still unwind the current scope.
        if (!(reason instanceof ConnectPurchaseEnvironmentChange) && !getConnectCredentialError(connect, password)) {
          return { ...settings, serverUrl: profile?.serverUrl ?? settings.serverUrl, username: profile?.username ?? settings.username, password, connect };
        }
        throw reason;
      }
    }
    return { ...settings, serverUrl: profile?.serverUrl ?? settings.serverUrl, username: profile?.username ?? settings.username, password, connect };
  }
}

export async function claimConnectAction(deps: AccessDeps, isCurrent = () => true) {
  const { controlPlaneUrl, pairingRef, pendingClaim, pendingPurchase, finishPurchase, setPhase, clearPairing } = deps;
  const authenticate: ActivationAuthenticate = (request) => authenticateConnectRequest(deps, request);
  await Promise.allSettled([...deps.accessRequests.current.values()]);
  if (pendingClaim.current) {
    const pending = pendingClaim.current;
    const hint = pending.response.activation ? { activation: pending.response.activation, ...(pending.pairingId ? { pairingId: pending.pairingId } : {}) } : undefined;
    return activateConnectProfile(deps, await requestConnectAccess(deps, pending.response.machine_id, pending.fromPairing ?? false), pending.fromPairing, isCurrent, hint, authenticate);
  }
  const current = pairingRef.current;
  if (!current) throw new Error('Scan or open a pairing link first.');
  if (current.controlPlaneUrl !== controlPlaneUrl) throw new Error('This QR is for a different subscription environment. Open a fresh QR from the matching connector.');
  if (pendingPurchase.current) await finishPurchase(pendingPurchase.current.purchase);
  setPhase('claiming');
  let response: ConnectClaim;
  try {
    const deviceName = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web test device';
    response = await retryTransient(() => authenticateConnectRequest(deps, (token) => claimConnectPairing(current, token, deviceName)), retryClaim);
  } catch (reason) {
    if (reason instanceof ConnectApiError && reason.machineId) {
      const hint = reason.activation ? { activation: reason.activation, pairingId: current.pairingId } : undefined;
      return activateConnectProfile(deps, await requestConnectAccess(deps, reason.machineId, true, true, true), true, isCurrent, hint, authenticate);
    }
    if (reason instanceof ConnectApiError && (reason.status === 404 || reason.invalidPairingToken || reason.pairingExpired)) await clearPairing();
    throw reason;
  }
  const stored = await loadConnectionProfiles(true);
  const exact = stored.find((profile) => profile.connect?.controlPlaneUrl === current.controlPlaneUrl && profile.connect.machineId === response.machine_id);
  // A retired connector may be replaced by a new machine_id. Replace the one
  // same-named profile only when the match is unambiguous.
  const names = [response.machine_name, current.machineName].map((name) => name.trim());
  const sameName = exact ? [] : stored.filter((profile) => profile.connect?.controlPlaneUrl === current.controlPlaneUrl && names.includes(profile.connect.machineName.trim()));
  const previous = exact ?? (sameName.length === 1 ? sameName[0] : undefined);
  if (!hasConnectClaimCredential(response)) {
    // A claim may omit the device credential. Verify the store silently so the
    // following access request uses a mobile session instead of reporting a
    // malformed pairing response.
    const session = await deps.recoverSession();
    deps.sessionRef.current = session;
    deps.setSession(session);
  }
  pendingClaim.current = { controlPlaneUrl: current.controlPlaneUrl, response, previous, fromPairing: true, pairingId: current.pairingId };
  const hint = response.activation ? { activation: response.activation, pairingId: current.pairingId } : undefined;
  return activateConnectProfile(deps, await requestConnectAccess(deps, response.machine_id, true), true, isCurrent, hint, authenticate);
}
