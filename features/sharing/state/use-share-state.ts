import { clearSharedPayloads, getResolvedSharedPayloadsAsync, getSharedPayloads } from 'expo-sharing';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { i18n } from '@/shared/i18n/index';
import type { Session } from '@/shared/protocol/opencode/types';
import { parseIncomingShare, type SharedPayload } from '@/features/sharing/model/parse';
import type { SessionDeepLinkTarget } from '@/shared/contracts/domain';

export const SHARE_TTL_MS = 10 * 60 * 1000;
export type ShareTarget = { connectionScope: string; projectPath: string; sessionId?: string; title?: string };
export type SharedInput = {
  pending: SharedPayload | null;
  target?: ShareTarget;
  targets: ShareTarget[];
  targetsError?: string;
  targetsLoading: boolean;
  emptyReason?: 'expired' | 'discarded';
  resolving: boolean;
  busy: boolean;
  error?: string;
  selectTarget: (target: ShareTarget) => void;
  refreshShared: () => Promise<void>;
  refreshTargets: () => Promise<void>;
  addToChat: () => Promise<boolean>;
  consumeShared: (target: ShareTarget) => SharedPayload | null;
  clearShared: () => void;
};
// Headless workspace snapshots do not own device share receipts; the app scope supplies them.
export const emptySharedInput: SharedInput = {
  pending: null, targets: [], targetsLoading: false, resolving: false, busy: false, selectTarget: () => {},
  refreshShared: async () => {}, refreshTargets: async () => {}, addToChat: async () => false,
  consumeShared: () => null, clearShared: () => {},
};
type Input = {
  hydrated: boolean;
  connectionScope: string;
  projectPath?: string;
  currentSessionId?: string;
  sessions: Session[];
  availableTargets?: ShareTarget[];
  createAt?: (target: ShareTarget) => Promise<Session>;
  hideSubagentChats: boolean;
  refreshTargets: () => Promise<unknown>;
  createSession: () => Promise<Session>;
  openSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
};

// Only confirmed receipts reach the composer. Revisions prevent late reads or
// cancelled navigation from resurrecting a discarded share.
export function useShareState(input: Input): SharedInput {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const [pending, setPending] = useState<SharedPayload | null>(null);
  const [target, setTarget] = useState<ShareTarget>();
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [emptyReason, setEmptyReason] = useState<'expired' | 'discarded'>();
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string>();
  const receipt = useRef<{ payload: SharedPayload; receivedAt: number; confirmed?: ShareTarget } | undefined>(undefined);
  const revision = useRef(0);
  const rawSignature = useRef('');
  const opening = useRef<AbortController | undefined>(undefined);
  const selected = useRef<ShareTarget | undefined>(undefined);
  const ingesting = useRef(false);
  const ingestAgain = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const adding = useRef(false);
  const targetChosen = useRef(false);
  const targetRefresh = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
    targetRefresh.current++;
    opening.current?.abort();
  }, []);

  const clearSharedState = useCallback((reason?: 'expired' | 'discarded') => {
    invalidate();
    receipt.current = undefined;
    selected.current = undefined;
    rawSignature.current = '';
    ingestAgain.current = false;
    setPending(null); setTarget(undefined); setError(undefined); setResolving(false); setBusy(false);
    setEmptyReason(reason); setTargetsError(undefined); setTargetsLoading(false);
    if (Platform.OS !== 'web') {
      try { clearSharedPayloads(); } catch { /* The native receipt may already be gone. */ }
    }
  }, [invalidate]);
  const clearShared = useCallback(() => clearSharedState('discarded'), [clearSharedState]);

  const refreshTargets = useCallback(async () => {
    const operation = ++targetRefresh.current;
    setTargetsLoading(true);
    setTargetsError(undefined);
    try {
      await latest.current.refreshTargets();
    } catch {
      if (operation === targetRefresh.current) setTargetsError(i18n.t('share:targetsUnavailable'));
    } finally {
      if (operation === targetRefresh.current) setTargetsLoading(false);
    }
  }, []);

  const refreshShared = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (ingesting.current) { ingestAgain.current = true; return; }
    const operation = revision.current;
    ingesting.current = true;
    try {
      const raw = getSharedPayloads();
      if (!raw.length) return;
      const signature = JSON.stringify(raw);
      if (signature === rawSignature.current) return;
      setResolving(true); setError(undefined);
      const payload = parseIncomingShare(await getResolvedSharedPayloadsAsync());
      if (operation !== revision.current) return;
      if (!payload) throw new Error(i18n.t('share:unavailable'));
      revision.current++;
      opening.current?.abort();
      rawSignature.current = signature;
      receipt.current = { payload, receivedAt: Date.now() };
      selected.current = undefined;
      targetChosen.current = false;
      setTarget(undefined); setPending(payload);
      setEmptyReason(undefined); setTargetsError(undefined);
      void refreshTargets();
    } catch (failure) {
      if (operation === revision.current) setError(failure instanceof Error ? failure.message : i18n.t('share:unavailable'));
    } finally {
      ingesting.current = false;
      if (operation === revision.current || receipt.current) setResolving(false);
      if (ingestAgain.current) { ingestAgain.current = false; void refreshRef.current(); }
    }
  }, [refreshTargets]);
  useLayoutEffect(() => { refreshRef.current = refreshShared; });

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- native launch/resume receipt.
    void refreshShared();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshShared();
    });
    return () => { subscription.remove(); invalidate(); };
  }, [invalidate, refreshShared]);

  useEffect(() => {
    if (!pending || !input.hydrated || !input.projectPath || (input.availableTargets && targetChosen.current)) return;
    if (selected.current?.connectionScope === input.connectionScope && (targetChosen.current ||
      (selected.current.sessionId === input.currentSessionId && selected.current.projectPath === input.projectPath))) return;
    targetChosen.current = false;
    opening.current?.abort();
    if (receipt.current) receipt.current.confirmed = undefined;
    const next = { connectionScope: input.connectionScope, projectPath: input.projectPath, sessionId: input.currentSessionId };
    selected.current = next;
    setTarget(next);
  }, [input.availableTargets, input.connectionScope, input.currentSessionId, input.hydrated, input.projectPath, pending]);

  useEffect(() => {
    if (!pending || !receipt.current) return;
    const timer = setTimeout(() => clearSharedState('expired'), Math.max(0, SHARE_TTL_MS - (Date.now() - receipt.current.receivedAt)));
    return () => clearTimeout(timer);
  }, [clearSharedState, pending]);

  const selectTarget = useCallback((next: ShareTarget) => {
    if (adding.current) return;
    if (next.connectionScope !== latest.current.connectionScope && !latest.current.availableTargets?.some((target) =>
      target.connectionScope === next.connectionScope && target.projectPath === next.projectPath && target.sessionId === next.sessionId)) return;
    selected.current = next;
    targetChosen.current = true;
    if (receipt.current) receipt.current.confirmed = undefined;
    setTarget(next); setError(undefined);
  }, []);

  const addToChat = useCallback(async () => {
    const held = receipt.current;
    const destination = selected.current;
    if (!held || !destination || adding.current || (!held.payload.text && !held.payload.url && !held.payload.attachments.length)) return false;
    const operation = revision.current;
    const controller = new AbortController();
    opening.current = controller;
    targetChosen.current = true;
    adding.current = true; setBusy(true); setError(undefined);
    const current = () => receipt.current === held && revision.current === operation &&
      !controller.signal.aborted && (latest.current.availableTargets !== undefined || destination.connectionScope === latest.current.connectionScope);
    try {
      if (!latest.current.createAt && !destination.sessionId && destination.projectPath !== latest.current.projectPath) throw new Error(i18n.t('share:destinationChanged'));
      const sessionId = destination.sessionId ?? (await (latest.current.createAt ? latest.current.createAt(destination) : latest.current.createSession())).id;
      if (!current()) return false;
      const resolved = { ...destination, sessionId };
      // Retain a created destination on retry instead of creating duplicates.
      selected.current = resolved; setTarget(resolved);
      const result = await latest.current.openSession(resolved, controller.signal);
      if (!current()) return false;
      if (!result.ok) throw new Error(result.error || i18n.t('share:destinationChanged'));
      held.confirmed = resolved;
      return true;
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : i18n.t('share:destinationChanged'));
      return false;
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }, []);

  const consumeShared = useCallback((destination: ShareTarget) => {
    const held = receipt.current;
    const confirmed = held?.confirmed;
    if (!held || !confirmed || !destination.sessionId || confirmed.sessionId !== destination.sessionId ||
      confirmed.projectPath !== destination.projectPath || confirmed.connectionScope !== destination.connectionScope) return null;
    const payload = held.payload;
    clearSharedState(undefined);
    return payload;
  }, [clearSharedState]);

  const targets = useMemo(() => input.availableTargets ?? input.sessions.filter((session) => session.directory && !session.time.archived &&
    (!input.hideSubagentChats || !session.parentID)).map((session) => ({
      connectionScope: input.connectionScope, projectPath: session.directory!, sessionId: session.id, title: session.title,
    })), [input.availableTargets, input.connectionScope, input.hideSubagentChats, input.sessions]);
  return useMemo(() => ({
    pending, target, targets, targetsError, targetsLoading, emptyReason, resolving, busy, error,
    selectTarget, refreshShared, refreshTargets, addToChat, consumeShared, clearShared,
  }), [pending, target, targets, targetsError, targetsLoading, emptyReason, resolving, busy, error,
    selectTarget, refreshShared, refreshTargets, addToChat, consumeShared, clearShared]);
}
