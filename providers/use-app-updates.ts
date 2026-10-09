import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadAppUpdates, type AppUpdateApi, type UpdateSnapshot } from '@/lib/app-updates';
import { APP_UPDATES_STORAGE_KEY } from '@/lib/storage-keys';
import { parseUpdatePreferences, UPDATE_DISMISS_INTERVAL, updateCheckDue, updateNotice, type UpdatePreferences } from '@/providers/app-update-policy';
import { createPersistenceWriter, loadPersistedValue } from '@/providers/persistence-hydration';

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
  const [preferences, setPreferences] = useState<UpdatePreferences>({ lastCheckAt: 0 });
  const [ready, setReady] = useState(false);
  const [surfaceActive, setSurfaceActive] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [blockerCount, setBlockerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
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
  const latest = useRef({ initialized, blocked, surfaceActive, foreground, preferences, snapshot, ready, installing });
  const [write] = useState(createPersistenceWriter);
  useLayoutEffect(() => { latest.current = { initialized, blocked, surfaceActive, foreground, preferences, snapshot, ready, installing }; });

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
    if (value.phase !== 'available' && value.phase !== 'downloaded') return;
    const dismissal = { version: value.version ?? 'downloaded', phase: value.phase, until: Date.now() + UPDATE_DISMISS_INTERVAL };
    const next = { ...latest.current.preferences, dismissal };
    latest.current.preferences = next;
    setPreferences(next);
  }, []);

  const check = useCallback(async () => {
    const current = latest.current;
    if (!api.current || !current.initialized || !current.ready || !current.foreground || suppressSession.current || checking.current || actionLock.current) return;
    const due = updateCheckDue(current.preferences.lastCheckAt, Date.now());
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
        const next = { ...result, version: result.version ?? (result.phase === 'downloaded' ? current.snapshot.version ?? 'downloaded' : undefined) };
        latest.current.snapshot = next;
        setSnapshot(next);
        setInstalling(result.phase === 'installing');
      }
    } catch { /* Store checks never block startup or produce unsolicited errors. */ }
    finally { checking.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    api.current = loadAppUpdates();
    const unsubscribe = api.current?.subscribe((event) => {
      if (!mounted.current) return;
      setNow(Date.now());
      eventRevision.current++;
      if (event.phase === 'cancelled' || event.phase === 'failed') {
        latest.current.installing = false;
        setInstalling(false);
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
      latest.current.installing = event.phase === 'installing';
      setInstalling(event.phase === 'installing');
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

  useEffect(() => { if (initialized && ready) void check(); }, [check, initialized, ready]);

  const safe = useCallback(() => {
    const current = latest.current;
    return current.initialized && current.ready && current.surfaceActive && current.foreground && !current.blocked && !current.installing &&
      !suppressSession.current && blockers.current.size === 0;
  }, []);

  const update = useCallback(async () => {
    if (!safe() || actionLock.current || !api.current) return;
    const adapter = api.current;
    const offered = latest.current.snapshot;
    if (!updateNotice(offered, latest.current.preferences, Date.now())) return;
    actionLock.current = true;
    setBusy(true); setError(false);
    try {
      // Lock the underlying UI before refreshing the native state and handing off to the store.
      const result = await readUpdate(adapter);
      const fresh = { ...result, version: result.version ?? offered.version };
      if (!mounted.current || !safe()) return;
      if (fresh.phase === 'downloaded') {
        if (offered.phase !== 'downloaded') { setSnapshot(fresh); latest.current.snapshot = fresh; return; }
        latest.current.installing = true;
        setInstalling(true);
        await adapter.complete();
        // Keep the interaction gate up until Play restarts the app or reports failure.
      } else if (fresh.phase === 'available') {
        await adapter.start();
        dismiss(offered);
      } else { latest.current.snapshot = fresh; setSnapshot(fresh); setInstalling(fresh.phase === 'installing'); }
    } catch {
      if (mounted.current) { latest.current.installing = false; setInstalling(false); setError(true); dismiss(offered); }
    } finally {
      actionLock.current = false;
      if (mounted.current) { setBusy(false); if (!latest.current.installing) void check(); }
    }
  }, [check, dismiss, safe]);

  const notice = initialized && ready && foreground && surfaceActive && !blocked && !blockerCount &&
    !busy && !installing && !suppressed ? updateNotice(snapshot, preferences, now) : undefined;
  const later = useCallback(() => dismiss(latest.current.snapshot), [dismiss]);
  const clearError = useCallback(() => setError(false), []);
  return useMemo(() => ({ notice, busy, installing, error: error && foreground && surfaceActive && !blocked && !blockerCount,
    update, later, clearError, block, setSurfaceActive }),
  [notice, busy, installing, error, foreground, surfaceActive, blocked, blockerCount, update, later, clearError, block]);
}
