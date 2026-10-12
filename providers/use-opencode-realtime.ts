import { subscribeEvents } from '@/lib/opencode/events';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpencodeEvent } from '@/lib/opencode/events';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';

type RealtimeActions = {
  onEvent: (event: OpencodeEvent) => void;
  onGlobalEvent?: (event: OpencodeEvent) => void;
  refreshSessions: (silent: boolean) => Promise<unknown>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshMessages: (sessionId: string, silent: boolean, options?: { full?: boolean }) => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
};

export function shouldPoll(streamConnected: boolean, busy: boolean) {
  return !streamConnected || busy;
}

export function useOpencodeRealtime({ catalogClient, activeProjectPath, connected, busy,
  currentSessionId, conversationSessionId, pendingSessionIds = [], ...actions
}: RealtimeActions & {
  catalogClient: ScopedOpencodeClient;
  activeProjectPath?: string;
  connected: boolean;
  busy: boolean;
  pendingSessionIds?: string[];
  currentSessionId?: string;
  conversationSessionId?: string;
}) {
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const latest = useRef({ ...actions, currentSessionId, conversationSessionId, pendingSessionIds });
  useLayoutEffect(() => {
    latest.current = { ...actions, currentSessionId, conversationSessionId, pendingSessionIds };
  });
  const inFlight = useRef<Promise<unknown> | undefined>(undefined);
  const reconcile = useCallback((full = false) => {
    if (inFlight.current) return inFlight.current;
    const next = latest.current;
    const sessions = new Set([...next.pendingSessionIds, next.currentSessionId, next.conversationSessionId].filter((id): id is string => Boolean(id)));
    const result = Promise.allSettled([
      next.refreshSessions(true), next.refreshPendingInteractions(),
      ...[...sessions].flatMap((id) => [next.refreshMessages(id, true, full ? { full: true } : undefined), next.refreshSessionDiff(id, true), next.refreshSessionTodos(id)]),
    ]).finally(() => { if (inFlight.current === result) inFlight.current = undefined; });
    inFlight.current = result;
    return result;
  }, []);

  useEffect(() => {
    inFlight.current = undefined;
    if (!connected || !activeProjectPath) {
      setEventStreamStatus('idle');
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let resumeRetry: (() => void) | undefined;
    const subscribe = async () => {
      let retryDelay = 1000;
      while (!controller.signal.aborted) {
        setEventStreamStatus(retryDelay === 1000 ? 'connecting' : 'error');
        try {
          const subscription = subscribeEvents(catalogClient, controller.signal);
          let reconciled = false;
          for await (const envelope of subscription) {
            if (controller.signal.aborted) break;
            if (!envelope) continue;
            setEventStreamStatus('connected');
            retryDelay = 1000;
            if (!reconciled) {
              reconciled = true;
              void reconcile(true);
            }
            latest.current.onGlobalEvent?.(envelope);
            if (envelope.location?.directory === activeProjectPath || !envelope.location?.directory) latest.current.onEvent(envelope);
          }
          if (!controller.signal.aborted) throw new Error('OpenCode event stream ended.');
        } catch {
          if (controller.signal.aborted) break;
          setEventStreamStatus('error');
          await new Promise<void>((resolve) => {
            resumeRetry = resolve;
            retryTimer = setTimeout(resolve, retryDelay);
          });
          retryDelay = Math.min(retryDelay * 2, 15000);
        }
      }
    };
    void subscribe();
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
      resumeRetry?.();
    };
  }, [activeProjectPath, catalogClient, connected, reconcile]);

  useEffect(() => {
    if (!connected || !activeProjectPath || !shouldPoll(eventStreamStatus === 'connected', busy)) return;
    // While SSE is healthy the loop is a safety net and runs slower; without a
    // stream it is the primary transport. Prompt completion across workspaces is
    // additionally covered by the post-send transcript refresh, so a slower
    // connected cadence cannot strand a finished turn.
    const intervalMs = eventStreamStatus === 'connected' ? 10000 : 5000;
    const interval = setInterval(() => { void reconcile(); }, intervalMs);
    return () => clearInterval(interval);
  }, [activeProjectPath, busy, connected, eventStreamStatus, reconcile]);

  return { eventStreamStatus };
}
