import type { Purchase } from 'expo-iap';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';

import {
  getConnectSession,
  getConnectStore,
  getPendingConnectPairing,
  hasConnectEntitlement,
  hasConnectSession,
  isConnectEnabled,
  listConnectMachines,
  parseConnectPairing,
  revokeConnectMachine,
  savePendingConnectPairing,
  type ConnectCatalog,
  type ConnectMachine,
  type ConnectPairing,
  type ConnectSession,
} from '@/lib/connect';
import { connectPurchaseRequest, isConnectPurchase, loadConnectStore, openConnectSubscriptionManagement, type ConnectOffer, type ConnectStoreApi } from '@/lib/connect-store';
import { deleteProfilePassword, loadConnectionProfiles, saveConnectionProfiles, type ConnectionProfile } from '@/lib/connection-profiles';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { ConnectionContextValue } from '@/providers/opencode-provider-types';

import { ConnectPurchaseEnvironmentChange, type PendingConnectPurchase } from '@/providers/services/connect-subscription-service';
import { loadConnectCatalog, type ConnectPhase } from '@/providers/connect/catalog';
import { finishConnectPurchase, listConnectPurchases, recoverConnectSession } from '@/providers/connect/purchases';
import { selectConnectControlPlane, acceptConnectLink, pairConnectLink } from '@/providers/connect/pairing';
import {
  authenticateConnectRequest,
  requestConnectAccess,
  prepareConnectSettings,
  activateConnectProfile,
  claimConnectAction,
  type AccessDeps,
  type PendingAccess,
} from '@/providers/connect/access';

export function useConnectState({ controlPlaneUrl, setControlPlaneUrl, switchConnection, disconnect, isHydrated, onProfileRefreshed, activeMachineId, beforeProfileRefresh }: {
  controlPlaneUrl: string;
  setControlPlaneUrl: Dispatch<SetStateAction<string>>;
  switchConnection: ConnectionContextValue['switchConnection'];
  disconnect: (profile: ConnectionProfile) => Promise<void>;
  isHydrated: boolean;
  activeMachineId?: string;
  beforeProfileRefresh: () => Promise<void>;
  onProfileRefreshed: (previous: ConnectionProfile, next: ConnectionProfile) => void;
}) {
  const enabled = isConnectEnabled();
  const store = getConnectStore();
  const [initialization, setInitialization] = useState<'loading' | 'ready' | 'error'>('loading');
  const autoPair = useRef(false);
  const linkLock = useRef(false);
  const [session, setSession] = useState<ConnectSession>();
  const [pairing, setPairing] = useState<ConnectPairing>();
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [offers, setOffers] = useState<ConnectOffer[]>([]);
  const [machines, setMachines] = useState<ConnectMachine[]>();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [savedProfile, setSavedProfile] = useState<ConnectionProfile>();
  const [storeReady, setStoreReady] = useState(false);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const [purchaseRecovery, setPurchaseRecovery] = useState<'unverified' | 'verified'>();
  const sessionRef = useRef<ConnectSession | undefined>(undefined);
  const entitlementRecovery = useRef(false);
  const pairingRef = useRef<ConnectPairing | undefined>(undefined);
  const apiRef = useRef<ConnectStoreApi | undefined>(undefined);
  const catalogRef = useRef<ConnectCatalog | undefined>(undefined);
  const lock = useRef(false);
  const pendingClaim = useRef<PendingAccess | undefined>(undefined);
  const pendingPurchase = useRef<PendingConnectPurchase | undefined>(undefined);
  const scopeGeneration = useRef(0);
  const purchaseQueue = useRef(new Map<string, Purchase>());
  const finishedPurchases = useRef(new Set<string>());
  const lastAccess = useRef(new Map<string, number>());
  const drainRef = useRef<() => void>(() => undefined);
  const recoveryMachineId = useRef<string | undefined>(undefined);
  const resumeRef = useRef<() => Promise<boolean | void>>(async () => undefined);
  const refreshRef = useRef<() => Promise<boolean | void>>(async () => undefined);

  const changeControlPlane = useCallback((next: string) => {
    scopeGeneration.current += 1;
    setInitialization('loading'); autoPair.current = false;
    const retainedPairing = pairingRef.current?.controlPlaneUrl === next ? pairingRef.current : undefined;
    setControlPlaneUrl(next); sessionRef.current = undefined; setSession(undefined);
    pairingRef.current = retainedPairing; setPairing(retainedPairing);
    catalogRef.current = undefined; recoveryMachineId.current = undefined;
    purchaseQueue.current.clear(); finishedPurchases.current.clear(); lastAccess.current.clear();
    setMachines(undefined); setSavedProfile(undefined); setOffers([]); setStoreReady(false);
    setPhase('idle'); setError(undefined); setNotice(undefined); setCanRetry(false);
  }, [setControlPlaneUrl]);

  const perform = useCallback(async (action: () => Promise<boolean | void>, preserveError = false) => {
    if (!enabled || lock.current) return false;
    lock.current = true;
    setBusy(true);
    if (!preserveError) setError(undefined);
    setNotice(undefined);
    setCanRetry(false);
    let nextControlPlane: string | undefined;
    try { return (await action()) !== false; }
    catch (reason) {
      if (reason instanceof ConnectPurchaseEnvironmentChange) nextControlPlane = reason.controlPlaneUrl;
      else { entitlementRecovery.current = false; setError(reason instanceof Error ? reason.message : 'Cloud Link setup failed. Try again.'); setCanRetry(true); }
      return false;
    }
    finally {
      lock.current = false; setBusy(false);
      if (nextControlPlane) changeControlPlane(nextControlPlane);
      else drainRef.current();
    }
  }, [changeControlPlane, enabled]);

  const clearPairing = useCallback(async () => {
    await savePendingConnectPairing(pairingRef.current?.controlPlaneUrl ?? controlPlaneUrl, store);
    pairingRef.current = undefined;
    setPairing(undefined);
  }, [controlPlaneUrl, store]);

  const finishPurchase = useCallback((purchase: Purchase) => finishConnectPurchase({
    controlPlaneUrl, store, apiRef, pendingPurchase, sessionRef, setSession, setPhase,
    setNotice, setPurchaseRecovery, finishedPurchases,
  }, purchase), [controlPlaneUrl, store]);

  const availablePurchases = useCallback(() => listConnectPurchases({ apiRef, catalogRef, store }), [store]);

  const recoverSession = useCallback(() => recoverConnectSession({ pendingPurchase, sessionRef, availablePurchases, finishPurchase }), [availablePurchases, finishPurchase]);

  const loadCatalog = useCallback(() => loadConnectCatalog({ controlPlaneUrl, store, apiRef, catalogRef, setOffers, setPhase }), [controlPlaneUrl, store]);

  const accessDeps = useMemo<AccessDeps>(() => ({
    controlPlaneUrl, store, sessionRef, pairingRef, pendingClaim, pendingPurchase, entitlementRecovery, recoveryMachineId,
    lastAccess, setSession, setPhase, setProfiles, setSavedProfile, switchConnection, beforeProfileRefresh,
    onProfileRefreshed, clearPairing, finishPurchase, recoverSession,
  }), [beforeProfileRefresh, clearPairing, controlPlaneUrl, finishPurchase, onProfileRefreshed, recoverSession, store, switchConnection]);

  const authenticated = useCallback(<T,>(request: (token: string) => Promise<T>) => authenticateConnectRequest(accessDeps, request), [accessDeps]);
  const requestAccess = useCallback((machineId: string, fromPairing = false) => requestConnectAccess(accessDeps, machineId, fromPairing), [accessDeps]);
  const prepareSettings = useCallback((settings: OpencodeConnectionSettings) => prepareConnectSettings(accessDeps, settings), [accessDeps]);
  const activate = useCallback((profile: ConnectionProfile) => activateConnectProfile(accessDeps, profile), [accessDeps]);
  const claimAction = useCallback(() => claimConnectAction(accessDeps), [accessDeps]);

  const refreshMachinesAction = useCallback(async () => {
    const next = await authenticated((token) => listConnectMachines(controlPlaneUrl, token));
    setMachines(next);
    setProfiles(await loadConnectionProfiles());
  }, [authenticated, controlPlaneUrl]);

  const continueAfterPurchase = useCallback(async () => {
    if (pairingRef.current || pendingClaim.current) return claimAction();
    const owned = await authenticated((token) => listConnectMachines(controlPlaneUrl, token));
    setMachines(owned);
    const stored = await loadConnectionProfiles();
    let active: ConnectionProfile | undefined;
    for (const profile of stored.filter((entry) => entry.connect?.controlPlaneUrl === controlPlaneUrl && owned.some((machine) => machine.id === entry.connect!.machineId))) {
      const refreshed = await requestAccess(profile.connect!.machineId);
      if (refreshed.connect!.machineId === activeMachineId) active = refreshed;
    }
    if (active) return activate(active);
    setPhase('idle');
    return true;
  }, [activate, activeMachineId, authenticated, claimAction, controlPlaneUrl, requestAccess]);
  useEffect(() => { resumeRef.current = continueAfterPurchase; }, [continueAfterPurchase]);

  useEffect(() => { drainRef.current = () => {
    if (lock.current || !catalogRef.current || !purchaseQueue.current.size) return;
    const [id, purchase] = purchaseQueue.current.entries().next().value!;
    if (pendingPurchase.current && pendingPurchase.current.purchase.id !== id) return;
    purchaseQueue.current.delete(id);
    if (finishedPurchases.current.has(id)) { drainRef.current(); return; }
    if (!isConnectPurchase(catalogRef.current, purchase, store)) { drainRef.current(); return; }
    void perform(async () => { if (await finishPurchase(purchase)) return resumeRef.current(); return false; });
  }; }, [finishPurchase, perform, store]);

  useEffect(() => {
    if (!enabled || !isHydrated || !controlPlaneUrl) return;
    const generation = ++scopeGeneration.current;
    let subscriptions: { remove(): void }[] = [];
    const current = () => generation === scopeGeneration.current;
    void perform(async () => {
      const [stored, pending, saved] = await Promise.all([getConnectSession(controlPlaneUrl, store), getPendingConnectPairing(controlPlaneUrl, store), loadConnectionProfiles()]);
      if (!current()) return false;
      sessionRef.current = stored; setSession(stored);
      if (!pairingRef.current) { pairingRef.current = pending; setPairing(pending); }
      setProfiles(saved);
      const api = await loadConnectStore();
      if (!current()) return false;
      apiRef.current = api;
      subscriptions = [api.purchaseUpdatedListener((purchase) => {
        if (!current() || finishedPurchases.current.has(purchase.id)) return;
        purchaseQueue.current.set(purchase.id, purchase); drainRef.current();
      }), api.purchaseErrorListener((reason) => {
        if (!current()) return;
        setPhase('idle');
        if (reason.code === 'user-cancelled') setNotice('Purchase canceled. No new access was granted.');
        else setError('The store could not complete the purchase. Try again or Restore.');
      })];
      if (!await api.initConnection()) throw new Error('Could not connect to the native store. Retry.');
      setStoreReady(true);
      await loadCatalog();
      if (pendingPurchase.current && !isConnectPurchase(catalogRef.current, pendingPurchase.current.purchase, store)) {
        pendingPurchase.current = undefined; setPurchaseRecovery(undefined);
      }
      const available = await availablePurchases();
      const unfinished = store === 'apple' ? await api.getPendingTransactionsIOS() : available.filter((purchase) => 'isAcknowledgedAndroid' in purchase && !purchase.isAcknowledgedAndroid);
      const retained = pendingPurchase.current?.purchase;
      const recoverable = (retained && isConnectPurchase(catalogRef.current, retained, store) ? retained : undefined) ?? unfinished.find((purchase) => isConnectPurchase(catalogRef.current, purchase, store) && purchase.purchaseState === 'purchased') ?? (!hasConnectEntitlement(stored) ? available[0] : undefined);
      if (recoverable) {
        if (await finishPurchase(recoverable)) await resumeRef.current();
      }
    }, true).then((ok) => { if (current()) setInitialization(ok ? 'ready' : 'error'); });
    return () => { scopeGeneration.current += 1; subscriptions.forEach((subscription) => subscription.remove()); void apiRef.current?.endConnection(); apiRef.current = undefined; };
  }, [availablePurchases, controlPlaneUrl, enabled, finishPurchase, isHydrated, initializationAttempt, loadCatalog, perform, store]);

  useEffect(() => { refreshRef.current = async () => {
    if (pendingPurchase.current) { await finishPurchase(pendingPurchase.current.purchase); return resumeRef.current(); }
    if (apiRef.current && catalogRef.current) {
      const available = await availablePurchases();
      const pending = store === 'apple' ? await apiRef.current.getPendingTransactionsIOS() : available.filter((purchase) => 'isAcknowledgedAndroid' in purchase && !purchase.isAcknowledgedAndroid);
      const unfinished = pending.find((purchase) => isConnectPurchase(catalogRef.current, purchase, store) && purchase.purchaseState === 'purchased' && !finishedPurchases.current.has(purchase.id));
      const recoverable = unfinished ?? (!hasConnectEntitlement(sessionRef.current) ? available[0] : undefined);
      if (recoverable) { await finishPurchase(recoverable); return resumeRef.current(); }
    }
  }; }, [availablePurchases, finishPurchase, store]);
  useEffect(() => {
    if (!enabled) return;
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active' && initialization === 'ready') void perform(() => refreshRef.current()); });
    return () => listener.remove();
  }, [enabled, initialization, perform]);

  const selectControlPlane = useCallback((url: string) => selectConnectControlPlane({
    url, enabled, isHydrated, phase, controlPlaneUrl, linkLock, lock, pendingClaim, pendingPurchase, changeControlPlane, setError,
  }), [changeControlPlane, controlPlaneUrl, enabled, isHydrated, phase]);

  const acceptLink = useCallback((link: Parameters<typeof parseConnectPairing>[0]) => acceptConnectLink({
    link, controlPlaneUrl, store, pendingClaim, sessionRef, pairingRef, setPairing, setSavedProfile, setPhase, setError, setNotice,
  }), [controlPlaneUrl, store]);

  const pairLink = useCallback((link: Parameters<typeof parseConnectPairing>[0]) => pairConnectLink({
    link, initialization, linkLock, autoPair, lock, pendingClaim, pendingPurchase, acceptLink,
  }), [acceptLink, initialization]);
  useEffect(() => {
    if (!autoPair.current || initialization !== 'ready' || busy || error || !pairing || !hasConnectEntitlement(session)) return;
    autoPair.current = false;
    void perform(claimAction);
  }, [busy, claimAction, error, initialization, pairing, perform, session]);
  const dismissError = useCallback(() => { setError(undefined); setNotice(undefined); }, []);

  const purchase = useCallback((key: string) => {
    if (pendingPurchase.current || phase === 'purchasing' || phase === 'pending') return Promise.resolve(false);
    return perform(async () => {
      const offer = offers.find((entry) => entry.key === key);
      if (!offer || !apiRef.current) throw new Error('Choose an available subscription first.');
      const previous = (await availablePurchases())[0];
      setPhase('purchasing');
      try { await apiRef.current.requestPurchase(connectPurchaseRequest(offer, previous, store)); }
      catch { setPhase('idle'); throw new Error('The native store could not start the purchase. Choose Purchase again or Restore.'); }
    });
  }, [availablePurchases, offers, perform, phase, store]);

  const restore = useCallback(() => perform(async () => {
    if (!apiRef.current) throw new Error('Restore requires a native development/store build.');
    setPhase('restoring');
    await apiRef.current.restorePurchases();
    await recoverSession();
    return continueAfterPurchase();
  }), [continueAfterPurchase, perform, recoverSession]);

  const manageSubscription = useCallback(() => {
    if (initialization !== 'ready' || pendingPurchase.current || ['purchasing', 'pending'].includes(phase)) return Promise.resolve(false);
    return perform(openConnectSubscriptionManagement);
  }, [initialization, perform, phase]);

  const retry = useCallback(() => {
    if (!apiRef.current) { setError(undefined); setInitialization('loading'); setInitializationAttempt((current) => current + 1); return Promise.resolve(false); }
    return perform(async () => {
    if (pendingPurchase.current) { await finishPurchase(pendingPurchase.current.purchase); return continueAfterPurchase(); }
    if (!catalogRef.current || !offers.length) return loadCatalog();
    if (pendingClaim.current || pairingRef.current) return claimAction();
    if (recoveryMachineId.current) return activate(await requestAccess(recoveryMachineId.current));
    return refreshMachinesAction();
    }).then((ok) => { if (ok) setInitialization('ready'); return ok; });
  }, [activate, claimAction, continueAfterPurchase, finishPurchase, loadCatalog, offers.length, perform, refreshMachinesAction, requestAccess]);
  const claim = useCallback(() => perform(claimAction), [claimAction, perform]);
  const refreshMachines = useCallback(() => perform(refreshMachinesAction), [perform, refreshMachinesAction]);
  const connectProfile = useCallback((profile: ConnectionProfile) => perform(() => activate(profile)), [activate, perform]);
  const connectMachine = useCallback((id: string) => perform(async () => activate(await requestAccess(id))), [activate, perform, requestAccess]);
  const cancelPairing = useCallback(() => perform(async () => { autoPair.current = false; await clearPairing(); setPhase('idle'); }), [clearPairing, perform]);

  const removeProfiles = useCallback(async (removed: ConnectionProfile[]) => {
    for (const profile of removed) await disconnect(profile);
    const stored = await loadConnectionProfiles(true);
    const next = stored.filter((profile) => !removed.some((item) => item.id === profile.id));
    await saveConnectionProfiles(next);
    await Promise.all(removed.map((profile) => deleteProfilePassword(profile.id)));
    setProfiles(next);
    if (removed.some((profile) => profile.id === savedProfile?.id)) { setSavedProfile(undefined); setPhase('idle'); }
  }, [disconnect, savedProfile?.id]);
  const forgetProfile = useCallback((profile: ConnectionProfile) => perform(async () => {
    await removeProfiles([profile]); setNotice('Connection forgotten on this device. The machine is still available to other devices.');
  }), [perform, removeProfiles]);
  const revokeMachine = useCallback((id: string) => perform(async () => {
    await authenticated((token) => revokeConnectMachine(controlPlaneUrl, id, token));
    await removeProfiles((await loadConnectionProfiles(true)).filter((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === id));
    setMachines((current) => current?.filter((machine) => machine.id !== id)); setNotice('Machine deleted; local credentials removed.');
  }), [authenticated, controlPlaneUrl, perform, removeProfiles]);

  const canChangeControlPlane = enabled && isHydrated && !busy && purchaseRecovery !== 'verified' && !['purchasing', 'pending', 'saving'].includes(phase);
  const canPurchase = !busy && storeReady && !purchaseRecovery && !['purchasing', 'pending'].includes(phase);
  return { enabled, initialization, pairLink, dismissError, controlPlaneUrl, canChangeControlPlane, canPurchase, hasToken: hasConnectSession(session), entitled: hasConnectEntitlement(session), subscriptionExpiresAt: session?.subscription_expires_at, pairing, phase, busy, error, notice, machines, profiles, savedProfile, offers, storeReady, canRetry, manageSubscription,
    selectControlPlane, acceptLink, purchase, restore, retry, claim, cancelPairing, refreshMachines, connectProfile, connectMachine, forgetProfile, revokeMachine, prepareSettings };
}

export type ConnectSetup = ReturnType<typeof useConnectState>;
