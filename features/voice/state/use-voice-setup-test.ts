import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useLocalWakeWord } from '@/shared/platform/voice/use-local-wake-word';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

export type VoiceSetupTest = {
  status: 'busy' | 'idle' | 'starting' | 'listening' | 'detected' | 'error';
  error?: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export const VoiceSetupTestContext = createContext<VoiceSetupTest | undefined>(undefined);
export const useVoiceTest = () => useContext(VoiceSetupTestContext);

// One app-wide test owner. Detection never enters the conversation submit path.
export function useVoiceSetupTest(preferences: ChatPreferences, conversationActive: boolean): VoiceSetupTest & { runConversation: (action: () => Promise<void>) => Promise<void> } {
  const [status, setStatus] = useState<VoiceSetupTest['status']>('idle');
  const [error, setError] = useState<string>();
  const [pendingConversations, setPendingConversations] = useState(0);
  const conversationReservations = useRef(0);
  const generation = useRef(0);
  const active = useRef(false);
  const owned = useRef(false);
  const stopping = useRef<Promise<void>>(Promise.resolve());
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const { start: startDetector, stop: stopDetector } = useLocalWakeWord({
    commandModel: preferences.localCommandModel,
    language: preferences.speechLocale,
    phrase: preferences.localWakePhrase,
    speakerThreshold: preferences.localSpeakerThreshold,
    verifySpeaker: preferences.localSpeakerVerification,
    onWake: () => {
      if (!active.current) return;
      active.current = false;
      generation.current += 1;
      setStatus('detected');
      if (owned.current) { owned.current = false; stopping.current = stopRef.current(); }
    },
    onRejected: () => {},
    onError: (message) => {
      if (!active.current) return;
      active.current = false;
      generation.current += 1;
      setError(message);
      setStatus('error');
      if (owned.current) { owned.current = false; stopping.current = stopRef.current(); }
    },
  });
  useEffect(() => { stopRef.current = stopDetector; }, [stopDetector]);
  const stop = useCallback(async () => {
    generation.current += 1;
    active.current = false;
    setStatus('idle');
    setError(undefined);
    if (owned.current) { owned.current = false; stopping.current = stopDetector(); }
    await stopping.current;
  }, [stopDetector]);
  const runConversation = useCallback(async (action: () => Promise<void>) => {
    conversationReservations.current += 1;
    setPendingConversations(conversationReservations.current);
    try { await stop(); await action(); }
    finally { conversationReservations.current -= 1; setPendingConversations(conversationReservations.current); }
  }, [stop]);
  const start = useCallback(async () => {
    if (conversationActive || conversationReservations.current || active.current || AppState.currentState === 'background') return;
    const request = ++generation.current;
    active.current = true;
    setError(undefined);
    setStatus('starting');
    try {
      await stopping.current;
      if (request !== generation.current) return;
      owned.current = true;
      const started = await startDetector();
      if (request !== generation.current) return;
      if (started) setStatus('listening');
      else {
        active.current = false; setStatus('error');
        if (owned.current) { owned.current = false; stopping.current = stopDetector(); }
      }
    } catch (reason) {
      if (request !== generation.current) return;
      active.current = false;
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
      if (owned.current) { owned.current = false; stopping.current = stopDetector(); await stopping.current; }
    }
  }, [conversationActive, startDetector, stopDetector]);
  useEffect(() => {
    if (conversationActive && active.current) void stop();
  }, [conversationActive, stop]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void stop();
    });
    return () => { subscription.remove(); active.current = false; generation.current += 1; if (owned.current) { owned.current = false; stopping.current = stopRef.current(); } };
  }, [stop]);
  return useMemo(() => ({ status: conversationActive || pendingConversations ? 'busy' : status, error, start, stop, runConversation }), [conversationActive, pendingConversations, status, error, start, stop, runConversation]);
}
