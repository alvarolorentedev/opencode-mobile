import { useQueryForeground } from '@/shared/server-data/client';
import { connectCatalogOptions } from '@/features/cloud-link/services/queries/cloud-link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Purchase } from 'expo-iap';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { connectTransition, initialConnectLifecycle } from '@/features/cloud-link/state/connect/lifecycle';

import { getConnectSession, getPendingConnectPairing, savePendingConnectPairing } from '@/shared/storage/cloud-link';
import { getConnectStore, hasConnectEntitlement, hasConnectSession, isConnectEnabled, parseConnectPairing, type ConnectPairing, type ConnectSession } from '@/shared/contracts/cloud-link';
import { listConnectMachines, revokeConnectMachine } from '@/shared/protocol/cloud-link/connect';
import { isConnectStoreInstall } from '@/shared/platform/install-identity';
import { connectPurchaseRequest, isConnectPurchase, loadConnectStore, openConnectSubscriptionManagement, type ConnectOffer, type ConnectStoreApi } from '@/shared/platform/billing/connect-store';
import { deleteProfilePassword, loadConnectionProfiles, mutateConnectionProfiles } from '@/shared/storage/connection-profiles';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import type { ConnectionContextValue } from '@/features/connections/index';

import { activateConnectProfile, authenticateConnectRequest, claimConnectAction, prepareConnectSettings, requestConnectAccess, type AccessDeps, type PendingAccess } from '@/features/cloud-link/state/connect/access';
import { loadConnectCatalog, type ConnectPhase } from '@/features/cloud-link/state/connect/catalog';
import { acceptConnectLink, pairConnectLink, selectConnectControlPlane } from '@/features/cloud-link/state/connect/pairing';
import { finishConnectPurchase, listConnectPurchases, recoverConnectSession } from '@/features/cloud-link/state/connect/purchases';
import { ConnectPurchaseEnvironmentChange, type PendingConnectPurchase } from '@/features/cloud-link/services/connect-subscription-service';
import type { ConnectActivation } from '@/features/cloud-link/state/connect/activation';

export function useConnectState({ controlPlaneUrl, setControlPlaneUrl, switchConnection, disconnect, isHydrated, onProfileRefreshed, activeMachineId, beforeProfileRefresh, migrateConnectConnectionScope, isActiveProfile, profiles, setProfiles }: {
  profiles: ConnectionProfile[];
  setProfiles: Dispatch<SetStateAction<ConnectionProfile[]>>;
  controlPlaneUrl: string;
  setControlPlaneUrl: Dispatch<SetStateAction<string>>;
  switchConnection: ConnectionContextValue['switchConnection'];
  disconnect: (profile: ConnectionProfile) => Promise<void>;
  isHydrated: boolean;
  activeMachineId?: string;
  beforeProfileRefresh: () => Promise<void>;
  migrateConnectConnectionScope: AccessDeps['migrateConnectConnectionScope'];
  onProfileRefreshed: (previous: ConnectionProfile, next: ConnectionProfile) => void;
  isActiveProfile: (profile: ConnectionProfile) => boolean;
}) {
  const enabled = isConnectEnabled();
  const store = getConnectStore();
  const cache = useQueryClient();
  const [lifecycle, transition] = useReducer(connectTransition, initialConnectLifecycle);
  const { initialization, phase, error, notice, purchaseRecovery } = lifecycle;
  const busy = lifecycle.operation === 'running';
  const canRetry = lifecycle.retryable;
  const setInitialization = useCallback((status: typeof initialization) => transition({ type: 'initialization', status }), []);
  const setPhase = useCallback((phase: ConnectPhase) => transition({ type: 'phase', phase }), []);
  const setError = useCallback((message?: string) => transition({ type: 'error', message }), []);
  const setNotice = useCallback((message?: string) => transition({ type: 'notice', message }), []);
  const setCanRetry = useCallback((allowed: boolean) => transition({ type: 'retry', allowed }), []);
  const setPurchaseRecovery = useCallback((checkpoint?: 'unverified' | 'verified') => transition({ type: 'recovery', checkpoint }), []);
  const readCatalog = useCallback(() => cache.getQueryData(connectCatalogOptions(controlPlaneUrl, store).queryKey), [cache, controlPlaneUrl, store]);
  const autoPair = useRef(false);
  const linkLock = useRef(false);
  const [session, setSession] = useState<ConnectSession>();
  const [pairing, setPairing] = useState<ConnectPairing>();
  const activation = useRef<ConnectActivation | undefined>(undefined);
  const [offers, setOffers] = useState<ConnectOffer[]>([]);
  const foreground = useQueryForeground();
  const machineCredential = useRef<{ token: string; revision: number } | undefined>(undefined);
  const [machineTarget, setMachineTarget] = useState<{ user: string; revision: number }>();
  const machineKey = ['cloudlink', controlPlaneUrl, store, 'machines', machineTarget?.user, machineTarget?.revision];
  const machineQuery = useQuery({ queryKey: machineKey, enabled: false, subscribed: foreground && Boolean(machineTarget),
    queryFn: ({ signal }) => listConnectMachines(controlPlaneUrl, sessionRef.current!.user_token, signal) });
  const machines = machineTarget ? machineQuery.data : undefined;
  const [savedProfile, setSavedProfile] = useState<ConnectionProfile>();
  const [storeReady, setStoreReady] = useState(false);
  const [storeInstall, setStoreInstall] = useState(false);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const sessionRef = useRef<ConnectSession | undefined>(undefined);
  const entitlementRecovery = useRef(false);
  const pairingRef = useRef<ConnectPairing | undefined>(undefined);
  const apiRef = useRef<ConnectStoreApi | undefined>(undefined);
  const lock = useRef(false);
  const pendingClaim = useRef<PendingAccess | undefined>(undefined);
  const pendingPurchase = useRef<PendingConnectPurchase | undefined>(undefined);
  const scopeGeneration = useRef(0);
  const purchaseQueue = useRef(new Map<string, Purchase>());
  const finishedPurchases = useRef(new Set<string>());
  const lastAccess = useRef(new Map<string, number>());
  const accessRequests = useRef(new Map<string, Promise<ConnectionProfile>>());
  const initializationTask = useRef<Promise<boolean> | undefined>(undefined);
  const activeMachineIdRef = useRef(activeMachineId);
  useLayoutEffect(() => { activeMachineIdRef.current = activeMachineId; });
  useLayoutEffect(() => {
    if (phase === 'delayed' && activation.current && !isActiveProfile(activation.current.profile)) {
      activation.current.controller.abort(); activation.current = undefined;
      setPhase('idle'); setCanRetry(false);
    }
  }, [activeMachineId, controlPlaneUrl, isActiveProfile, phase, setCanRetry, setPhase]);
  const drainRef = useRef<() => void>(() => undefined);
  const recoveryMachineId = useRef<string | undefined>(undefined);
  const resumeRef = useRef<() => Promise<boolean | void>>(async () => undefined);
  const refreshRef = useRef<() => Promise<boolean | void>>(async () => undefined);

  const changeControlPlane = useCallback((next: string) => {
    activation.current?.controller.abort(); activation.current = undefined;
    scopeGeneration.current += 1;
    setInitialization('loading'); autoPair.current = false;
    const retainedPairing = pairingRef.current?.controlPlaneUrl === next ? pairingRef.current : undefined;
    setControlPlaneUrl(next); sessionRef.current = undefined; setSession(undefined);
    pairingRef.current = retainedPairing; setPairing(retainedPairing);
    recoveryMachineId.current = undefined;
    transition({ type: 'environmentChanged' });
    purchaseQueue.current.clear(); finishedPurchases.current.clear(); lastAccess.current.clear();
    setMachineTarget(undefined); setSavedProfile(undefined); setOffers([]); setStoreReady(false);
    setPhase('idle'); setError(undefined); setNotice(undefined); setCanRetry(false);
  }, [setCanRetry, setControlPlaneUrl, setError, setInitialization, setNotice, setPhase]);

  const perform = useCallback(async (action: () => Promise<boolean | void>, preserveError = false) => {
    if (!enabled || lock.current) return false;
    lock.current = true;
    transition({ type: 'started', preserveError });
    const generation = scopeGeneration.current;
    let nextControlPlane: string | undefined;
    try { return (await action()) !== false; }
    catch (reason) {
      if (generation !== scopeGeneration.current) return false;
      if (reason instanceof ConnectPurchaseEnvironmentChange) nextControlPlane = reason.controlPlaneUrl;
      else { entitlementRecovery.current = false; transition({ type: 'failed', message: reason instanceof Error ? reason.message : 'Cloud Link setup failed. Try again.' }); }
      return false;
    }
    finally {
      lock.current = false;
      if (generation === scopeGeneration.current) {
        transition({ type: 'completed' });
        if (nextControlPlane) changeControlPlane(nextControlPlane);
        else drainRef.current();
      }
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
  }, purchase), [controlPlaneUrl, setNotice, setPhase, setPurchaseRecovery, store]);

  const availablePurchases = useCallback(() => listConnectPurchases({ apiRef, catalog: readCatalog(), store }), [readCatalog, store]);

  const recoverSession = useCallback(() => recoverConnectSession({ pendingPurchase, sessionRef, availablePurchases, finishPurchase }), [availablePurchases, finishPurchase]);

  const waitForInitialization = useCallback(async () => {
    if (initializationTask.current && !await initializationTask.current) throw new Error('Cloud Link initialization failed. Retry setup before reconnecting.');
  }, []);

  const loadCatalog = useCallback(async () => loadConnectCatalog({ catalog: await cache.fetchQuery(connectCatalogOptions(controlPlaneUrl, store)), store, apiRef, setOffers, setPhase }), [cache, controlPlaneUrl, setPhase, store]);

  const accessDeps = useMemo<AccessDeps>(() => ({
    activation, isActiveProfile,
    controlPlaneUrl, store, sessionRef, pairingRef, pendingClaim, pendingPurchase, entitlementRecovery, recoveryMachineId,
    lastAccess, accessRequests, setSession, setPhase, setProfiles, setSavedProfile, switchConnection, beforeProfileRefresh, migrateConnectConnectionScope,
    onProfileRefreshed, clearPairing, finishPurchase, recoverSession, waitForInitialization,
  }), [migrateConnectConnectionScope, beforeProfileRefresh, clearPairing, controlPlaneUrl, finishPurchase, isActiveProfile, onProfileRefreshed, recoverSession, setPhase, setProfiles, store, switchConnection, waitForInitialization]);

  const authenticated = useCallback(<T,>(request: (token: string) => Promise<T>) => authenticateConnectRequest(accessDeps, request), [accessDeps]);
  const requestAccess = useCallback((machineId: string, fromPairing = false) => requestConnectAccess(accessDeps, machineId, fromPairing), [accessDeps]);
  const prepareSettings = useCallback((settings: OpencodeConnectionSettings) => prepareConnectSettings(accessDeps, settings), [accessDeps]);
  const activate = useCallback((profile: ConnectionProfile, waitForStartup = false) => {
    const generation = scopeGeneration.current;
    return activateConnectProfile(accessDeps, profile, waitForStartup, () => generation === scopeGeneration.current);
  }, [accessDeps]);
  const claimAction = useCallback(() => {
    const generation = scopeGeneration.current;
    return claimConnectAction(accessDeps, () => generation === scopeGeneration.current);
  }, [accessDeps]);

  const readMachines = useCallback(() => authenticated(async (token) => {
    if (machineCredential.current?.token !== token) machineCredential.current = { token, revision: (machineCredential.current?.revision ?? 0) + 1 };
    const target = { user: sessionRef.current!.user_id, revision: machineCredential.current.revision };
    setMachineTarget(target);
    return cache.fetchQuery({ queryKey: ['cloudlink', controlPlaneUrl, store, 'machines', target.user, target.revision], staleTime: 0,
      queryFn: ({ signal }) => listConnectMachines(controlPlaneUrl, token, signal) });
  }), [authenticated, cache, controlPlaneUrl, store]);
  const refreshMachinesAction = useCallback(async () => {
    await readMachines();
    setProfiles(await loadConnectionProfiles());
  }, [readMachines, setProfiles]);

  const continueAfterPurchase = useCallback(async () => {
    if (pairingRef.current || pendingClaim.current) return claimAction();
    const owned = await readMachines();
    const stored = await loadConnectionProfiles();
    let active: ConnectionProfile | undefined;
    for (const profile of stored.filter((entry) => entry.connect?.controlPlaneUrl === controlPlaneUrl && owned.some((machine) => machine.id === entry.connect!.machineId))) {
      const refreshed = await requestAccess(profile.connect!.machineId);
      if (refreshed.connect!.machineId === activeMachineIdRef.current) active = refreshed;
    }
    if (active && active.connect!.machineId === activeMachineIdRef.current) return activate(active);
    setPhase('idle');
    return true;
  }, [activate, claimAction, controlPlaneUrl, readMachines, requestAccess, setPhase]);
  useEffect(() => { resumeRef.current = continueAfterPurchase; }, [continueAfterPurchase]);

  useEffect(() => { drainRef.current = () => {
    if (lock.current || !readCatalog() || !purchaseQueue.current.size) return;
    const [id, purchase] = purchaseQueue.current.entries().next().value!;
    if (pendingPurchase.current && pendingPurchase.current.purchase.id !== id) return;
    purchaseQueue.current.delete(id);
    if (finishedPurchases.current.has(id)) { drainRef.current(); return; }
    if (!isConnectPurchase(readCatalog(), purchase, store)) { drainRef.current(); return; }
    void perform(async () => { if (await finishPurchase(purchase)) return resumeRef.current(); return false; });
  }; }, [finishPurchase, perform, readCatalog, store]);

  useEffect(() => {
    if (!enabled || !isHydrated || !controlPlaneUrl) return;
    const generation = ++scopeGeneration.current;
    let subscriptions: { remove(): void }[] = [];
    const current = () => generation === scopeGeneration.current;
    let initialized!: (ready: boolean) => void;
    initializationTask.current = new Promise<boolean>((resolve) => { initialized = resolve; });
    void perform(async () => {
      setStoreReady(false);
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
      if (!current()) return false;
      setStoreReady(true);
      await loadCatalog();
      if (pendingPurchase.current && !isConnectPurchase(readCatalog(), pendingPurchase.current.purchase, store)) {
        pendingPurchase.current = undefined; setPurchaseRecovery(undefined);
      }
      const available = await availablePurchases();
      const unfinished = store === 'apple' ? await api.getPendingTransactionsIOS() : available.filter((purchase) => 'isAcknowledgedAndroid' in purchase && !purchase.isAcknowledgedAndroid);
      const retained = pendingPurchase.current?.purchase;
      const recoverable = (retained && isConnectPurchase(readCatalog(), retained, store) ? retained : undefined) ?? unfinished.find((purchase) => isConnectPurchase(readCatalog(), purchase, store) && purchase.purchaseState === 'purchased') ?? (!hasConnectEntitlement(stored) ? available[0] : undefined);
      if (recoverable) {
        if (await finishPurchase(recoverable)) { initialized(true); await resumeRef.current(); }
      }
    }, true).then((ok) => {
      const ready = ok || Boolean(activation.current);
      initialized(ready);
      if (current()) { initializationTask.current = undefined; setInitialization(ready ? 'ready' : 'error'); }
    });
    return () => { initialized(false); scopeGeneration.current += 1; activation.current?.controller.abort(); activation.current = undefined; subscriptions.forEach((subscription) => subscription.remove()); void apiRef.current?.endConnection(); apiRef.current = undefined; };
  }, [availablePurchases, controlPlaneUrl, enabled, finishPurchase, isHydrated, initializationAttempt, loadCatalog, perform, readCatalog, store, setProfiles, setPhase, setNotice, setError, setPurchaseRecovery, setInitialization]);

  // Store-install resolution is a capability query, independent of hydration
  // and of the store connection itself. The dialog only appears once the
  // platform confirms an App Store or Google Play install.
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void isConnectStoreInstall().then((value) => { if (active) setStoreInstall(value); }, () => undefined);
    return () => { active = false; };
  }, [enabled]);

  useEffect(() => { refreshRef.current = async () => {
    if (pendingPurchase.current) { await finishPurchase(pendingPurchase.current.purchase); return resumeRef.current(); }
    if (apiRef.current && readCatalog()) {
      const available = await availablePurchases();
      const pending = store === 'apple' ? await apiRef.current.getPendingTransactionsIOS() : available.filter((purchase) => 'isAcknowledgedAndroid' in purchase && !purchase.isAcknowledgedAndroid);
      const unfinished = pending.find((purchase) => isConnectPurchase(readCatalog(), purchase, store) && purchase.purchaseState === 'purchased' && !finishedPurchases.current.has(purchase.id));
      const recoverable = unfinished ?? (!hasConnectEntitlement(sessionRef.current) ? available[0] : undefined);
      if (recoverable) { await finishPurchase(recoverable); return resumeRef.current(); }
    }
  }; }, [availablePurchases, finishPurchase, readCatalog, store]);
  useEffect(() => {
    if (!enabled) return;
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active' && initialization === 'ready' && !activation.current) void perform(() => refreshRef.current()); });
    return () => listener.remove();
  }, [enabled, initialization, perform]);

  const selectControlPlane = useCallback((url: string) => {
    if (accessRequests.current.size && url !== controlPlaneUrl) {
      setError('Wait for machine access to finish before changing Cloud Link environments.');
      return false;
    }
    return selectConnectControlPlane({ url, enabled, isHydrated, phase, controlPlaneUrl, linkLock, lock, pendingClaim, pendingPurchase, changeControlPlane, setError });
  }, [changeControlPlane, controlPlaneUrl, enabled, isHydrated, phase, setError]);

  const acceptLink = useCallback(async (link: Parameters<typeof parseConnectPairing>[0]) => {
    const accepted = await acceptConnectLink({
    link, controlPlaneUrl, store, pendingClaim, sessionRef, pairingRef, setPairing, setSavedProfile, setPhase, setError, setNotice,
    });
    if (accepted) { activation.current?.controller.abort(); activation.current = undefined; }
    return accepted;
  }, [controlPlaneUrl, setError, setNotice, setPhase, store]);

  const pairLink = useCallback((link: Parameters<typeof parseConnectPairing>[0]) => pairConnectLink({
    link, initialization, linkLock, autoPair, lock, pendingClaim, pendingPurchase, acceptLink,
  }), [acceptLink, initialization]);
  useEffect(() => {
    if (!autoPair.current || initialization !== 'ready' || busy || error || !pairing || !hasConnectEntitlement(session)) return;
    autoPair.current = false;
    void perform(claimAction);
  }, [busy, claimAction, error, initialization, pairing, perform, session]);
  const dismissError = useCallback(() => { setError(undefined); setNotice(undefined); }, [setError, setNotice]);

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
  }, [availablePurchases, offers, perform, phase, setPhase, store]);

  const restore = useCallback(() => perform(async () => {
    if (!apiRef.current) throw new Error('Restore requires a native development/store build.');
    setPhase('restoring');
    await apiRef.current.restorePurchases();
    await recoverSession();
    return continueAfterPurchase();
  }), [continueAfterPurchase, perform, recoverSession, setPhase]);

  const manageSubscription = useCallback(() => {
    if (initialization !== 'ready' || pendingPurchase.current || ['purchasing', 'pending'].includes(phase)) return Promise.resolve(false);
    return perform(openConnectSubscriptionManagement);
  }, [initialization, perform, phase]);

  const retry = useCallback(() => {
    if (lock.current) return Promise.resolve(false);
    if (!apiRef.current || (initialization === 'error' && !pendingPurchase.current)) {
      setError(undefined); setStoreReady(false); setInitialization('loading');
      setInitializationAttempt((current) => current + 1); return Promise.resolve(false);
    }
    return perform(async () => {
    if (activation.current && phase === 'delayed') return activate(activation.current.profile, true);
    if (pendingPurchase.current) { await finishPurchase(pendingPurchase.current.purchase); return continueAfterPurchase(); }
    if (!readCatalog() || !offers.length) return loadCatalog();
    if (pendingClaim.current || pairingRef.current) return claimAction();
    if (recoveryMachineId.current) return activate(await requestAccess(recoveryMachineId.current));
    if (savedProfile) return activate(savedProfile);
    return refreshMachinesAction();
    }).then((ok) => { if (ok) setInitialization('ready'); return ok; });
  }, [activate, claimAction, continueAfterPurchase, finishPurchase, initialization, loadCatalog, offers.length, perform, phase, readCatalog, refreshMachinesAction, requestAccess, savedProfile, setError, setInitialization]);
  const claim = useCallback(() => perform(claimAction), [claimAction, perform]);
  const refreshMachines = useCallback(() => perform(refreshMachinesAction), [perform, refreshMachinesAction]);
  const connectProfile = useCallback((profile: ConnectionProfile) => perform(() => activate(profile)), [activate, perform]);
  const connectMachine = useCallback((id: string) => perform(async () => activate(await requestAccess(id))), [activate, perform, requestAccess]);
  const cancelPairing = useCallback(() => perform(async () => { activation.current?.controller.abort(); activation.current = undefined; autoPair.current = false; await clearPairing(); setPhase('idle'); }), [clearPairing, perform, setPhase]);

  const removeProfiles = useCallback(async (removed: ConnectionProfile[]) => {
    for (const profile of removed) await disconnect(profile);
    const next = await mutateConnectionProfiles(async (stored, save) => {
      const next = stored.filter((profile) => !removed.some((item) => item.id === profile.id));
      await save(next);
      await Promise.all(removed.map((profile) => deleteProfilePassword(profile.id)));
      return next;
    });
    setProfiles(next);
    if (removed.some((profile) => profile.id === activation.current?.profile.id)) { activation.current?.controller.abort(); activation.current = undefined; }
    if (removed.some((profile) => profile.id === savedProfile?.id)) { setSavedProfile(undefined); setPhase('idle'); }
  }, [disconnect, savedProfile?.id, setPhase, setProfiles]);
  const forgetProfile = useCallback((profile: ConnectionProfile) => perform(async () => {
    await removeProfiles([profile]); setNotice('Connection forgotten on this device. The machine is still available to other devices.');
  }), [perform, removeProfiles, setNotice]);
  const revokeMachine = useCallback((id: string) => perform(async () => {
    await authenticated((token) => revokeConnectMachine(controlPlaneUrl, id, token));
    await removeProfiles((await loadConnectionProfiles(true)).filter((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === id));
    await readMachines(); setNotice('Machine deleted; local credentials removed.');
  }), [authenticated, controlPlaneUrl, perform, readMachines, removeProfiles, setNotice]);

  const canChangeControlPlane = enabled && isHydrated && !busy && purchaseRecovery !== 'verified' && !['purchasing', 'pending', 'saving'].includes(phase);
  const canPurchase = initialization === 'ready' && !busy && storeReady && !purchaseRecovery && !['purchasing', 'pending'].includes(phase);
  return useMemo(() => ({ enabled, storeInstall, initialization, pairLink, dismissError, controlPlaneUrl, canChangeControlPlane, canPurchase, hasToken: hasConnectSession(session), entitled: hasConnectEntitlement(session), subscriptionExpiresAt: session?.subscription_expires_at, pairing, phase, busy, error, notice, machines, profiles, savedProfile, offers, storeReady, canRetry: canRetry || phase === 'delayed', manageSubscription,
    selectControlPlane, acceptLink, purchase, restore, retry, claim, cancelPairing, refreshMachines, connectProfile, connectMachine, forgetProfile, revokeMachine, prepareSettings }), [enabled, storeInstall, initialization, pairLink, dismissError, controlPlaneUrl, canChangeControlPlane, canPurchase,
    session, pairing, phase, busy, error, notice, machines, profiles, savedProfile, offers, storeReady, canRetry, manageSubscription,
    selectControlPlane, acceptLink, purchase, restore, retry, claim, cancelPairing, refreshMachines, connectProfile, connectMachine, forgetProfile, revokeMachine, prepareSettings]);
}

export type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
