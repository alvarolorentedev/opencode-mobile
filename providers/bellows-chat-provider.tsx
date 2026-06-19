import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  type BellowsChatMessage,
  type BellowsConnectionSettings,
  type BellowsModel,
  bellowsChatCompletion,
  bellowsListModels,
} from '@/lib/bellows/client';
import { useOpencode } from '@/providers/opencode-provider';
import { BELLOWS_CHAT_MESSAGES_STORAGE_KEY } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BellowsChatContextValue {
  messages: BellowsChatMessage[];
  loading: boolean;
  error: string | null;
  models: BellowsModel[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const BellowsChatContext = createContext<BellowsChatContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BellowsChatProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useOpencode();

  const connectionSettings = useMemo<BellowsConnectionSettings>(() => ({
    serverUrl: settings.bellowsServerUrl || 'http://127.0.0.1:4000',
    apiKey: settings.bellowsApiKey || 'sk-anvil-safe-key',
  }), [settings.bellowsServerUrl, settings.bellowsApiKey]);

  const [messages, setMessages] = useState<BellowsChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<BellowsModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('gpt-4o');

  // Keep a ref to the latest messages so sendMessage never captures a stale snapshot
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Keep a ref to connectionSettings for use in callbacks
  const connectionSettingsRef = useRef(connectionSettings);
  connectionSettingsRef.current = connectionSettings;

  // Load persisted messages on mount
  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      try {
        const stored = await AsyncStorage.getItem(BELLOWS_CHAT_MESSAGES_STORAGE_KEY);
        if (!cancelled && stored) {
          const parsed = JSON.parse(stored) as BellowsChatMessage[];
          setMessages(parsed);
        }
      } catch {
        // Silently ignore load failures
      }
    }

    void loadMessages();
    return () => { cancelled = true; };
  }, []);

  // Fetch available models when connectionSettings change
  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        const result = await bellowsListModels(connectionSettings);
        if (!cancelled) {
          setModels(result);
        }
      } catch {
        // Models list is optional - silently ignore fetch failures
      }
    }

    void fetchModels();
    return () => { cancelled = true; };
  }, [connectionSettings]);

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: BellowsChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messagesRef.current, userMessage];
    setMessages(updatedMessages);
    setLoading(true);
    setError(null);

    // Persist after adding user message
    void AsyncStorage.setItem(BELLOWS_CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(updatedMessages));

    try {
      const response = await bellowsChatCompletion(connectionSettingsRef.current, {
        model: selectedModel,
        messages: updatedMessages,
      });

      const assistantMessage = response.choices[0]?.message;
      if (assistantMessage) {
        const withAssistant = [...updatedMessages, assistantMessage];
        setMessages(withAssistant);
        // Persist after adding assistant message
        void AsyncStorage.setItem(BELLOWS_CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(withAssistant));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    void AsyncStorage.removeItem(BELLOWS_CHAT_MESSAGES_STORAGE_KEY);
  }, []);

  const value = useMemo<BellowsChatContextValue>(() => ({
    messages,
    loading,
    error,
    models,
    selectedModel,
    setSelectedModel,
    sendMessage,
    clearMessages,
  }), [messages, loading, error, models, selectedModel, sendMessage, clearMessages]);

  return (
    <BellowsChatContext.Provider value={value}>
      {children}
    </BellowsChatContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBellowsChat(): BellowsChatContextValue {
  const ctx = useContext(BellowsChatContext);
  if (!ctx) {
    throw new Error('useBellowsChat must be used within a BellowsChatProvider');
  }
  return ctx;
}
