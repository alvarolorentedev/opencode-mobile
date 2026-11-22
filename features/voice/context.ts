import { useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { useWorkspacePreferences } from '@/runtime/workspace';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { LOCAL_WAKE_PHRASES, normalizeLocalWakePhrase } from '@/shared/platform/voice/local-wake-word/types';
import { normalizeWakePhrase } from '@/shared/platform/voice/wake-phrase';

import { useConversationSnapshot } from './state/conversation/use-conversation-snapshot';
import { useVoiceTest } from './state/use-voice-setup-test';

const EMPTY = {};

export function useConversation(messages?: SessionMessageRecord[]) {
  const { voice, commands: { workspace: { resolveKey } } } = useAppCore();
  const scopeKey = useAppStore((state) => state.registry.focus ? resolveKey(state.registry.focus) : '');
  const state = useAppStore((app) => app.conversation[scopeKey]);
  const { chatPreferences } = useWorkspacePreferences();
  const runConversation = useVoiceTest()?.runConversation;
  const actions = useMemo(() => ({
    cancel: () => voice.read(scopeKey)?.confirmation.cancel(),
    confirm: (text?: string) => voice.read(scopeKey)?.confirmation.confirm(text),
    edit: () => voice.read(scopeKey)?.confirmation.edit(),
    retry: () => voice.read(scopeKey)?.confirmation.retry(),
  }), [scopeKey, voice]);
  const pending = state?.confirmation;
  const speaking = state?.confirmationSpeaking === true;
  const confirmation = useMemo(() => pending ? { active: true, phase: pending.phase, text: pending.text, heard: pending.heard,
    error: pending.error, speaking, actions } : undefined, [actions, pending, speaking]);
  const sessionId = state?.sessionId;
  const messagesBySession = useMemo(() => sessionId && messages ? { [sessionId]: messages } : EMPTY, [messages, sessionId]);
  const conversation = useConversationSnapshot({
    conversationConfirmation: confirmation,
    conversationFeedback: state?.feedback,
    conversationFeedbackAction: state?.feedbackAction ?? 'none',
    conversationLatestHeardText: state?.latestHeardText,
    conversationListeningLevel: state?.level ?? 0,
    conversationInputPhase: state?.phase ?? 'off',
    conversationReadbackPhase: state?.readbackPhase ?? 'idle',
    conversationSessionId: sessionId,
    messagesBySession,
    wakePhrase: state?.wakeSensor === 'local'
      ? LOCAL_WAKE_PHRASES[normalizeLocalWakePhrase(chatPreferences.localWakePhrase)].label
      : normalizeWakePhrase(chatPreferences.conversationWakePhrase),
    wakePhraseRequired: chatPreferences.wakePhraseRequired,
  });
  return useMemo(() => {
    const toggle = () => voice.toggle(scopeKey);
    return { conversation, clearConversationFeedback: () => voice.read(scopeKey)?.clearFeedback(),
      toggleConversationMode: () => runConversation ? runConversation(toggle) : toggle() };
  }, [conversation, runConversation, scopeKey, voice]);
}
