import { useLayoutEffect, useMemo, useRef, type SetStateAction } from 'react';

import { useAppCore, useAppStore, type AppState } from '@/runtime/core';

type ConversationRuntimeState = NonNullable<AppState['conversation'][string]>;

export function useConversationRuntimeState(scopeKey: string) {
  const { store } = useAppCore();
  const state = useAppStore((app) => app.conversation[scopeKey]);
  const mountedScope = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    mountedScope.current = scopeKey;
    return () => {
      mountedScope.current = undefined;
      store.getState().clearConversation(scopeKey);
    };
  }, [scopeKey, store]);

  const actions = useMemo(() => {
    const setter = <K extends keyof ConversationRuntimeState>(key: K) => (value: SetStateAction<ConversationRuntimeState[K]>) => {
      if (mountedScope.current === scopeKey) store.getState().setConversationValue(scopeKey, key, value);
    };
    return {
      getConversationPhase: () => (mountedScope.current === scopeKey ? store.getState().conversation[scopeKey]?.phase : undefined) ?? 'off',
      getReadbackPhase: () => (mountedScope.current === scopeKey ? store.getState().conversation[scopeKey]?.readbackPhase : undefined) ?? 'idle',
      setConversationPhase: setter('phase'),
      setReadbackPhase: setter('readbackPhase'),
      setConversationTurnSequence: setter('turnSequence'),
      setConversationSessionId: setter('sessionId'),
      setQueuedConversationPrompt: setter('queuedPrompt'),
      setPendingConversationTurn: setter('pendingTurn'),
      setConversationFeedback: setter('feedback'),
      setConversationFeedbackAction: setter('feedbackAction'),
      setConversationLatestHeardText: setter('latestHeardText'),
      setConversationWakeSensor: setter('wakeSensor'),
    };
  }, [scopeKey, store]);

  return {
    ...actions,
    conversationPhase: state?.phase ?? 'off',
    conversationReadbackPhase: state?.readbackPhase ?? 'idle',
    conversationTurnSequence: state?.turnSequence ?? 0,
    conversationSessionId: state?.sessionId,
    queuedConversationPrompt: state?.queuedPrompt,
    pendingConversationTurn: state?.pendingTurn,
    conversationFeedback: state?.feedback,
    conversationFeedbackAction: state?.feedbackAction ?? 'none',
    conversationLatestHeardText: state?.latestHeardText,
    conversationWakeSensor: state?.wakeSensor ?? 'phrase',
  };
}
