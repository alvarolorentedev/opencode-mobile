import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent, subscribeEvents } from '@/shared/protocol/opencode/events';
import { nextPollDelay, shouldPoll } from '@/runtime/realtime/polling';
import { createReconciler, type ReconcileSources } from '@/runtime/realtime/reconcile';
import { startRealtimeTransport, type Foreground, type StreamStatus } from '@/runtime/realtime/transport';

export type RealtimeScopeInput = Omit<ReconcileSources, 'pendingSessionIds' | 'streamConnected'> & {
  workspaceKey?: string;
  projectPath?: string;
  pendingSessionIds?: string[];
  busy: boolean;
  constrained?: boolean;
  onEvent: (event: OpencodeEvent) => void;
  onGlobalEvent?: (event: OpencodeEvent) => void;
  beginHydration?: (sessionId: string) => () => void;
  hasMessages?: (sessionId: string) => boolean;
  refreshVcsDiff?: (scope: 'uncommitted' | 'branch', silent: boolean) => Promise<unknown>;
};

type Transport = { client: ScopedOpencodeClient; subscribe: typeof subscribeEvents };

export function createRealtime(foreground: Foreground, onFatalError: Parameters<typeof startRealtimeTransport>[0]['onFatalError'], onEvent?: (event: OpencodeEvent) => void) {
  const listeners = new Set<() => void>();
  const scopes = new Set<ReturnType<typeof createScope>>();
  let status: StreamStatus = 'idle';
  let transport: Transport | undefined;
  let stopTransport: (() => void) | undefined;

  function publish(next: StreamStatus) {
    if (status === next) return;
    status = next;
    for (const scope of scopes) scope.syncPolling();
    for (const listener of listeners) listener();
  }

  function reconcile() {
    for (const scope of scopes) scope.reconcile();
  }

  function createScope() {
    let input: RealtimeScopeInput | undefined;
    let stopPoll: (() => void) | undefined;
    let pollFailed = false;
    const reconciler = createReconciler({
      getSources: () => ({ ...input!, pendingSessionIds: input?.pendingSessionIds ?? [], streamConnected: status === 'connected' }),
      onPollFailure: (failed) => { pollFailed = failed; },
    });

    function syncPolling() {
      stopPoll?.();
      stopPoll = undefined;
      const streamConnected = status === 'connected';
      if (!input?.projectPath || !transport || !shouldPoll(streamConnected, input.busy)) return;
      const constrained = input.constrained ?? false;
      let failures = 0;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = async () => {
        if (stopped) return;
        await reconciler.reconcile();
        if (stopped) return;
        failures = pollFailed ? Math.min(failures + 1, 3) : 0;
        schedule();
      };
      const schedule = () => { timer = setTimeout(() => { void tick(); }, nextPollDelay({ streamConnected, constrained, failures })); };
      schedule();
      stopPoll = () => { stopped = true; clearTimeout(timer); };
    }

    function reconcileScope() {
      if (transport && input?.projectPath) void reconciler.reconcile(true);
    }

    const scope = {
      isBusy: () => Boolean(input?.projectPath && input.busy),
      getSources: () => input,
      syncPolling,
      reconcile: reconcileScope,
      dispatch(event: OpencodeEvent) {
        const directory = event.location?.directory;
        if (!input?.projectPath) return;
        input.onGlobalEvent?.(event);
        if (!directory || input.projectPath === directory) input.onEvent(event);
      },
      update(next: RealtimeScopeInput) {
        const previous = input;
        input = next;
        if (previous?.projectPath !== next.projectPath) {
          reconciler.reset();
          if (status === 'connected') reconcileScope();
        }
        if (!previous || previous.busy !== next.busy || previous.constrained !== next.constrained || previous.projectPath !== next.projectPath) syncPolling();
      },
      reset() {
        reconciler.reset();
        pollFailed = false;
      },
      dispose() {
        stopPoll?.();
        stopPoll = undefined;
        reconciler.reset();
        scopes.delete(scope);
      },
    };
    return scope;
  }

  function setTransport(next?: Transport) {
    if (transport?.client === next?.client && transport?.subscribe === next?.subscribe) return;
    stopTransport?.();
    stopTransport = undefined;
    transport = next;
    for (const scope of scopes) scope.reset();
    publish('idle');
    if (!next) return;
    stopTransport = startRealtimeTransport({
      ...next, foreground, onFatalError, reconcile,
      onStatus: publish,
      getStatus: () => status,
      isBusy: () => [...scopes].some((scope) => scope.isBusy()),
      dispatch(event) {
        onEvent?.(event);
        for (const scope of scopes) scope.dispatch(event);
      },
    });
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    createScope() {
      const scope = createScope();
      scopes.add(scope);
      return scope;
    },
    setTransport,
    getProjectSources(projectPath: string, workspaceKey?: string) {
      for (const scope of scopes) {
        const sources = scope.getSources();
        if (sources?.projectPath === projectPath && (workspaceKey === undefined || workspaceKey === sources.workspaceKey)) return sources;
      }
    },
    dispose() {
      setTransport();
      for (const scope of scopes) scope.dispose();
      listeners.clear();
    },
  };
}
