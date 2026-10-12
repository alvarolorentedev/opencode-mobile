import { AppState } from 'react-native';

import { getProfilePassword, type ConnectionProfile } from '@/lib/connection-profiles';
import type { AccessDeps } from './access';

export type ConnectActivation = { profile: ConnectionProfile; controller: AbortController; startup: boolean };
const startupDelays = [3_000, 6_000, 12_000, 15_000];

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function waitForForeground(signal: AbortSignal) {
  if (AppState.currentState === 'active' || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => { subscription.remove(); signal.removeEventListener('abort', finish); resolve(); };
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') finish(); });
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted || AppState.currentState === 'active') finish();
  });
}

export async function activateConnectProfile(deps: AccessDeps, profile: ConnectionProfile, waitForStartup = false, isCurrent = () => true) {
  if (!isCurrent()) return false;
  const { activation, setSavedProfile, setPhase, switchConnection, isActiveProfile } = deps;
  activation.current?.controller.abort();
  const startup = waitForStartup && Boolean(profile.connect);
  const attempt: ConnectActivation = { profile, controller: new AbortController(), startup };
  activation.current = attempt;
  const current = () => isCurrent() && !attempt.controller.signal.aborted && activation.current === attempt;
  const deadline = Date.now() + 120_000;
  let delayed = false;
  try {
    const password = await getProfilePassword(profile.id);
    if (!current()) return false;
    setSavedProfile(profile);
    setPhase(startup ? 'waitingForApproval' : 'connecting');
    for (let index = 0; ; index += 1) {
      if (startup) await waitForForeground(attempt.controller.signal);
      if (!current()) return false;
      if (index > 0 && !isActiveProfile(profile)) { setPhase('idle'); return false; }
      if (startup && Date.now() >= deadline) {
        delayed = true; setPhase('delayed'); return false;
      }
      const result = await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, connect: profile.connect }, profile.modelPreferences);
      if (!current()) return false;
      if (!isActiveProfile(profile)) { setPhase('idle'); return false; }
      if (result.status === 'connected') { setPhase('paired'); return true; }
      if (!startup || !result.retryableStartup) { setPhase('connecting'); throw new Error(result.message); }
      const remaining = deadline - Date.now();
      if (remaining > 0) await wait(Math.min(startupDelays[Math.min(index, startupDelays.length - 1)], remaining), attempt.controller.signal);
    }
  } finally {
    // Keep the delayed checkpoint until an explicit retry or fresh scan.
    if (activation.current === attempt && !delayed) activation.current = undefined;
  }
}
