import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadAppUpdates, type AppUpdateApi, type UpdateSnapshot } from '@/shared/platform/app-updates';
import { APP_UPDATES_STORAGE_KEY } from '@/shared/storage/keys';
import { DEFAULT_UPDATE_CHECK_PERIOD, parseUpdatePreferences, UPDATE_CHECK_INTERVALS, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice, type UpdateCheckPeriod, type UpdatePreferences } from '@/features/updates/model/app-update-policy';
import { createPersistenceWriter, loadPersistedValue } from '@/shared/storage/persistence-hydration';

async function readUpdate(api: AppUpdateApi) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([api.check(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Update check timed out')), 15000);
    })]);
  } finally { clearTimeout(timeout); }
}

export function useAppUpdates({ initialized, blocked }: { initialized: boolean; blocked: boolean }) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>({ phase: 'none' });
  const [preferences, setPreferences] = useState<UpdatePreferences>(() => ({ lastCheckAt: 0, enabled: true, checkPeriod: DEFAULT_UPDATE_CHECK_PERIOD }));
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [nativeConsent, setNativeConsent] = useState(false);
  const [surfaceActive, setSurfaceActive] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [blockerCount, setBlockerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const api = useRef<AppUpdateApi | null>(null);
  const blockers = useRef(new Set<symbol>());
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const checking = useRef(false);
  const eventRevision = useRef(0);
  const suppressSession = useRef(false);
  const latest = useRef({ initialized, blocked, surfaceActive, foreground, preferences, snapshot, ready });
  const [write] = useState(createPersistenceWriter);
  useLayoutEffect(() => { latest.current = { initialized, blocked, surfaceActive, foreground, preferences, snapshot, ready }; });

  const block = useCallback(() => {
    const token = Symbol();
    blockers.current.add(token);
    setBlockerCount(blockers.current.size);
    return () => {
      blockers.current.delete(token);
      setBlockerCount(blockers.current.size);
    };
  }, []);

  const dismiss = useCallback((value: UpdateSnapshot) => {
    if (value.phase !== 'available' && value.phase !== 'inProgress') return;
    const dismissal = { version: value.version ?? 'immediate', phase: 'available' as const, until: Date.now() + UPDATE_DISMISS_INTERVAL };
    const next = { ...latest.current.preferences, dismissal };
    latest.current.preferences = next;
    setPreferences(next);
  }, []);

  const check = useCallback(async () => {
    const current = latest.current;
    if (!api.current || !current.initialized || !current.ready || !current.foreground || suppressSession.current || checking.current || actionLock.current) return;
    if (!current.preferences.enabled || !current.surfaceActive || current.blocked || blockers.current.size) return;
    const due = updateCheckDue(current.preferences.lastCheckAt, Date.now(), UPDATE_CHECK_INTERVALS[current.preferences.checkPeriod]);
    if (!due && !api.current.supportsRecovery) return;
    checking.current = true;
    const revision = eventRevision.current;
    if (due) {
      const nextPreferences = { ...current.preferences, lastCheckAt: Date.now() };
      latest.current.preferences = nextPreferences;
      setPreferences(nextPreferences);
    }
    try {
      const result = await readUpdate(api.current);
      if (mounted.current && revision === eventRevision.current) {
        if (!due && result.phase === 'available') return;
        const next = result;
        latest.current.snapshot = next;
        setSnapshot(next);
      }
    } catch { /* Store checks never block startup or produce unsolicited errors. */ }
    finally { checking.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    api.current = loadAppUpdates();
    setSupported(Boolean(api.current));
    setNativeConsent(Boolean(api.current?.nativeConsent));
    const unsubscribe = api.current?.subscribe((event) => {
      if (!mounted.current) return;
      setNow(Date.now());
      eventRevision.current++;
      if (event.phase === 'cancelled' || event.phase === 'failed') {
        dismiss({ ...latest.current.snapshot, phase: 'available' });
        setError(event.phase === 'failed');
        const next: UpdateSnapshot = { ...latest.current.snapshot, phase: 'none' };
        latest.current.snapshot = next;
        setSnapshot(next);
        return;
      }
      const next = { ...latest.current.snapshot, phase: event.phase };
      latest.current.snapshot = next;
      setSnapshot(next);
    });
    if (api.current) void loadPersistedValue(AsyncStorage, APP_UPDATES_STORAGE_KEY, parseUpdatePreferences, (value) => {
      if (mounted.current) { latest.current.preferences = value; setPreferences(value); }
    }).then((readable) => {
      if (!mounted.current) return;
      if (!readable) { suppressSession.current = true; setSuppressed(true); write.preserveUnread(APP_UPDATES_STORAGE_KEY); }
      setReady(true);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      latest.current.foreground = state === 'active';
      setNow(Date.now());
      setForeground(state === 'active');
      if (state === 'active') void check();
    });
    return () => { mounted.current = false; unsubscribe?.(); subscription.remove(); api.current = null; };
  }, [check, dismiss, write]);

  useEffect(() => {
    if (ready && !suppressed) void write(APP_UPDATES_STORAGE_KEY, JSON.stringify(preferences), () =>
      AsyncStorage.setItem(APP_UPDATES_STORAGE_KEY, JSON.stringify(preferences))).catch(() => undefined);
  }, [preferences, ready, suppressed, write]);

  useEffect(() => {
    const until = preferences.dismissal?.until;
    if (!until) return;
    const remaining = until - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(remaining, UPDATE_DISMISS_INTERVAL)));
    return () => clearTimeout(timer);
  }, [preferences.dismissal]);

  useEffect(() => { if (initialized && ready && surfaceActive && !blocked && !blockerCount) void check(); }, [check, initialized, ready, surfaceActive, blocked, blockerCount]);

  const safe = useCallback(() => {
    const current = latest.current;
    return current.initialized && current.ready && current.preferences.enabled && current.surfaceActive && current.foreground && !current.blocked &&
      !suppressSession.current && blockers.current.size === 0;
  }, []);

  const update = useCallback(async () => {
    if (!safe() || actionLock.current || !api.current) return;
    const adapter = api.current;
    const offered = latest.current.snapshot;
    if (!updateNotice(offered, latest.current.preferences, Date.now())) return;
    let attempted = offered;
    actionLock.current = true;
    setBusy(true); setError(false);
    try {
      // Lock the underlying UI before refreshing the native state and handing off to the store.
      const result = await readUpdate(adapter);
      const fresh = { ...result, version: result.version ?? offered.version };
      if (!mounted.current || !safe()) return;
      attempted = fresh;
      if (fresh.phase === 'available' || fresh.phase === 'inProgress') {
        latest.current.snapshot = fresh;
        setSnapshot(fresh);
        // Suppress before native handoff: native error fallback can open Play without an event.
        dismiss(fresh);
        await adapter.start(() => mounted.current && safe());
      } else { latest.current.snapshot = fresh; setSnapshot(fresh); }
    } catch {
      if (mounted.current) { setError(true); dismiss(attempted); }
    } finally {
      actionLock.current = false;
      if (mounted.current) { setBusy(false); void check(); }
    }
  }, [check, dismiss, safe]);

  const setEnabled = useCallback((enabled: boolean) => {
    const next = { ...latest.current.preferences, enabled };
    latest.current.preferences = next;
    setPreferences(next);
    if (enabled) void check();
  }, [check]);
  const setCheckPeriod = useCallback((checkPeriod: UpdateCheckPeriod) => {
    const next = { ...latest.current.preferences, checkPeriod };
    latest.current.preferences = next;
    setPreferences(next);
    if (checkPeriod === 'available') void check();
  }, [check]);
  const candidate = initialized && ready && foreground && surfaceActive && !blocked && !blockerCount &&
    !busy && !suppressed && preferences.enabled ? updateNotice(snapshot, preferences, now) : undefined;
  useEffect(() => {
    if (candidate && nativeConsent) void update();
  }, [candidate, nativeConsent, update]);
  const notice = nativeConsent ? undefined : candidate;
  const later = useCallback(() => dismiss(latest.current.snapshot), [dismiss]);
  const clearError = useCallback(() => setError(false), []);
  return useMemo(() => ({ notice, busy, error: error && foreground && surfaceActive && !blocked && !blockerCount,
    update, later, clearError, block, setSurfaceActive, supported, enabled: preferences.enabled, checkPeriod: preferences.checkPeriod, setEnabled, setCheckPeriod }),
  [notice, busy, error, foreground, surfaceActive, blocked, blockerCount, update, later, clearError, block, supported, preferences.enabled, preferences.checkPeriod, setEnabled, setCheckPeriod]);
}
