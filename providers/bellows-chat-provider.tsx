import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  type BellowsChatMessage,
  type BellowsModel,
  bellowsChatCompletion,
  bellowsListModels,
  defaultBellowsSettings,
} from '@/lib/bellows/client';

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
  const [messages, setMessages] = useState<BellowsChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<BellowsModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('gpt-4o');

  // Keep a ref to the latest messages so sendMessage never captures a stale snapshot
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Fetch available models on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        const result = await bellowsListModels(defaultBellowsSettings);
        if (!cancelled) {
          setModels(result);
        }
      } catch {
        // Models list is optional - silently ignore fetch failures
      }
    }

    void fetchModels();
    return () => { cancelled = true; };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: BellowsChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messagesRef.current, userMessage];
    setMessages(updatedMessages);
    setLoading(true);
    setError(null);

    try {
      const response = await bellowsChatCompletion(defaultBellowsSettings, {
        model: selectedModel,
        messages: updatedMessages,
      });

      const assistantMessage = response.choices[0]?.message;
      if (assistantMessage) {
        setMessages(prev => [...prev, assistantMessage]);
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
