import { AppState } from 'react-native';

import { getProfilePassword } from '@/shared/storage/connection-profiles';
import { withSpan } from '@/shared/observability/client';
import { getConnectMachineActivation, getConnectPairingActivation, ConnectApiError } from '@/shared/protocol/cloud-link/connect';
import type { ConnectActivation } from '@/shared/contracts/cloud-link';
import type { ConnectPhase } from '@/shared/contracts/cloud-link-setup';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import type { AccessDeps } from '@/features/cloud-link/state/connect/access';

export type ConnectActivationHint = { activation: ConnectActivation; pairingId?: string };
export type ConnectActivationAttempt = { profile: ConnectionProfile; controller: AbortController; startup: boolean; hint?: ConnectActivationHint; server?: boolean; startActiveMachineId?: string; phase?: ConnectPhase };
export type ActivationAuthenticate = <T>(request: (token: string) => Promise<T>) => Promise<T>;

const startupDelays = [3_000, 6_000, 12_000, 15_000];
const startupBudget = 120_000;
// Safety net only: an activation-aware service drives the wait. This prevents a
// permanently blocked screen if the connector never reports ready.
const activationMaxWait = 10 * 60_000;
const defaultRetry = 2_000;
const maxRetry = 60_000;

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

function activationDeadline(activation: ConnectActivation) {
  const expires = activation.expires_at ? Date.parse(activation.expires_at) : NaN;
  const cap = Date.now() + activationMaxWait;
  return Number.isFinite(expires) ? Math.min(expires, cap) : cap;
}

function retryDelay(activation: ConnectActivation) {
  return Math.min(Math.max(activation.retry_after_ms ?? defaultRetry, 500), maxRetry);
}

function activationPhase(activation: ConnectActivation) {
  if (activation.state === 'pending_approval') return 'waitingForApproval' as const;
  if (activation.state === 'tunnel_starting') return 'waitingForTunnel' as const;
  return 'connecting' as const;
}

function applyPhase(attempt: ConnectActivationAttempt, update: (phase: ConnectPhase) => void, phase: ConnectPhase) {
  if (attempt.phase === phase) return;
  attempt.phase = phase;
  update(phase);
}

type ActivationWait = 'ready' | 'fallback' | 'expired' | 'declined' | 'cancelled';

async function waitForActivation(
  deps: AccessDeps,
  attempt: ConnectActivationAttempt,
  hint: ConnectActivationHint,
  authenticate: ActivationAuthenticate,
  current: () => boolean,
): Promise<ActivationWait> {
  const machineId = attempt.profile.connect?.machineId;
  if (!machineId) return 'fallback';
  const signal = attempt.controller.signal;
  let activation = hint.activation;
  let deadline = activationDeadline(activation);
  applyPhase(attempt, deps.setPhase, activationPhase(activation));
  if (activation.state === 'ready') return 'ready';
  for (;;) {
    if (!current()) return 'cancelled';
    if (Date.now() >= deadline) return 'expired';
    await waitForForeground(signal);
    if (!current()) return 'cancelled';
    if (Date.now() >= deadline) return 'expired';
    let next: ConnectActivation | undefined;
    try {
      next = await withSpan('cloudlink.activation.poll', { state: activation.state }, () => authenticate((token) => hint.pairingId
        ? getConnectPairingActivation(deps.controlPlaneUrl, hint.pairingId, token, signal)
        : getConnectMachineActivation(deps.controlPlaneUrl, machineId, token, signal)));
    } catch (reason) {
      if (!current()) return 'cancelled';
      if (reason instanceof Error && reason.name === 'ConnectPurchaseEnvironmentChange') throw reason;
      if (reason instanceof ConnectApiError) {
        if (reason.activationUnsupported || reason.status === 404) return 'fallback';
        if (reason.pairingExpired) return 'expired';
        if (reason.status === 409) return /declin/i.test(reason.message) ? 'declined' : 'fallback';
        if (reason.status === 401 || reason.status === 403) throw reason;
        if (reason.status === 429 || reason.status === 502 || reason.status === 503) {
          await wait(retryDelay(activation), signal);
          continue;
        }
        throw reason;
      }
      // Transient network/DNS failures keep polling without touching credentials.
      await wait(defaultRetry, signal);
      continue;
    }
    if (!next) return 'fallback';
    if (next.expires_at) {
      const expires = Date.parse(next.expires_at);
      if (Number.isFinite(expires)) deadline = Math.min(deadline, expires);
    }
    activation = next;
    applyPhase(attempt, deps.setPhase, activationPhase(activation));
    if (activation.state === 'ready') return 'ready';
    await wait(retryDelay(activation), signal);
  }
}

export async function activateConnectProfile(
  deps: AccessDeps,
  profile: ConnectionProfile,
  waitForStartup = false,
  isCurrent = () => true,
  hint?: ConnectActivationHint,
  authenticate?: ActivationAuthenticate,
) {
  if (!isCurrent()) return false;
  const { activation, setSavedProfile, setPhase, switchConnection, isActiveProfile } = deps;
  const previousHint = activation.current?.hint;
  activation.current?.controller.abort();
  const startup = waitForStartup && Boolean(profile.connect);
  const machineId = profile.connect?.machineId;
  const recorded = machineId ? deps.activationHints.current.get(machineId) : undefined;
  if (recorded && machineId) deps.activationHints.current.delete(machineId);
  const resolvedHint = recorded ?? hint ?? previousHint;
  const attempt: ConnectActivationAttempt = { profile, controller: new AbortController(), startup, hint: resolvedHint, server: Boolean(resolvedHint), startActiveMachineId: deps.activeMachineId.current };
  activation.current = attempt;
  const current = () => isCurrent() && !attempt.controller.signal.aborted && activation.current === attempt;
  let delayed = false;
  try {
    const password = await getProfilePassword(profile.id);
    if (!current()) return false;
    setSavedProfile(profile);
    let ready = resolvedHint?.activation.state === 'ready';
    if (resolvedHint && authenticate) {
      if (!ready) {
        const outcome = await waitForActivation(deps, attempt, resolvedHint, authenticate, current);
        if (outcome === 'cancelled') return false;
        if (outcome === 'expired' || outcome === 'declined') {
          // Keep the saved profile and delayed checkpoint for explicit recovery,
          // but do not re-poll a terminal pairing state.
          delayed = true;
          attempt.hint = undefined;
          applyPhase(attempt, setPhase, 'delayed');
          return false;
        }
        ready = outcome === 'ready';
      }
    }
    if (!ready && resolvedHint) attempt.server = false;
    if (ready) applyPhase(attempt, setPhase, 'connecting');
    const deadline = Date.now() + startupBudget;
    if (!ready) applyPhase(attempt, setPhase, startup ? 'waitingForApproval' : 'connecting');
    for (let index = 0; ; index += 1) {
      if (startup) await waitForForeground(attempt.controller.signal);
      if (!current()) return false;
      if (index > 0 && !isActiveProfile(profile)) { applyPhase(attempt, setPhase, 'idle'); return false; }
      if (startup && Date.now() >= deadline) {
        delayed = true; applyPhase(attempt, setPhase, 'delayed'); return false;
      }
      const result = await withSpan('cloudlink.activate', { startup, attempt: index }, async (span) => {
        const value = await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, connect: profile.connect }, profile.modelPreferences);
        span.setAttribute('status', value.status);
        if (value.kind) span.setAttribute('failureKind', value.kind);
        if (value.retryableStartup) span.setAttribute('retryableStartup', true);
        return value;
      });
      if (!current()) return false;
      if (!isActiveProfile(profile)) { applyPhase(attempt, setPhase, 'idle'); return false; }
      if (result.status === 'connected') { applyPhase(attempt, setPhase, 'paired'); return true; }
      if (!startup || !result.retryableStartup) { applyPhase(attempt, setPhase, 'connecting'); throw new Error(result.message); }
      const remaining = deadline - Date.now();
      if (remaining > 0) await wait(Math.min(startupDelays[Math.min(index, startupDelays.length - 1)], remaining), attempt.controller.signal);
    }
  } finally {
    // Keep the delayed checkpoint until an explicit retry or fresh scan.
    if (activation.current === attempt && !delayed) activation.current = undefined;
  }
}
