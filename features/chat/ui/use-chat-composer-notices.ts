import { useCallback, useEffect, useRef, useState } from 'react';

import type { TranscriptEntry } from '@/shared/presentation/format';
import type { PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';

type ComposerNoticesInput = {
  cancelPrompt: (sessionId: string, promptId: string) => Promise<void>;
  currentSessionId?: string;
  inputRef: { current: { draft: string } };
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  setDraft: (value: string) => void;
  transcript: TranscriptEntry[];
  unrevertSession: (sessionId: string) => Promise<void>;
};

// Revert and pending-prompt close actions share the composer draft. Keeping the
// ownership guards here prevents a slow cancel from leaking text into another
// session.
export function useChatComposerNotices({
  cancelPrompt,
  currentSessionId,
  inputRef,
  revertSession,
  setDraft,
  transcript,
  unrevertSession,
}: ComposerNoticesInput) {
  const [cancelingPromptId, setCancelingPromptId] = useState<string | undefined>();
  const [isCancelingRevert, setIsCancelingRevert] = useState(false);
  const currentSessionIdRef = useRef(currentSessionId);
  const revertPrefillRef = useRef<{ sessionId: string; text: string } | undefined>(undefined);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const handleRevertMessage = useCallback(async (sessionId: string, messageId: string) => {
    const entry = transcript.find((item) => item.id === messageId);
    if (!entry || entry.role !== 'user') {
      return;
    }
    await revertSession(sessionId, messageId);
    if (currentSessionIdRef.current !== sessionId) {
      return;
    }
    revertPrefillRef.current = { sessionId, text: entry.text };
    setDraft(entry.text);
  }, [revertSession, setDraft, transcript]);

  const handleCancelRevert = useCallback(async (sessionId: string) => {
    if (isCancelingRevert) {
      return;
    }
    setIsCancelingRevert(true);
    try {
      const pending = revertPrefillRef.current;
      await unrevertSession(sessionId);
      if (pending?.sessionId === sessionId && revertPrefillRef.current === pending) {
        if (currentSessionIdRef.current === sessionId && inputRef.current.draft === pending.text) {
          setDraft('');
        }
        revertPrefillRef.current = undefined;
      }
    } finally {
      setIsCancelingRevert(false);
    }
  }, [inputRef, isCancelingRevert, setDraft, unrevertSession]);

  const handleCancelPendingPrompt = useCallback(async (prompt: PendingPrompt) => {
    if (cancelingPromptId) {
      return;
    }
    setCancelingPromptId(prompt.id);
    try {
      await cancelPrompt(prompt.sessionId, prompt.id);
      if (currentSessionIdRef.current === prompt.sessionId && !inputRef.current.draft.trim()) {
        setDraft(prompt.text);
      }
    } finally {
      setCancelingPromptId(undefined);
    }
  }, [cancelPrompt, cancelingPromptId, inputRef, setDraft]);

  const clearRevertPrefill = useCallback((sessionId: string) => {
    if (revertPrefillRef.current?.sessionId === sessionId) {
      revertPrefillRef.current = undefined;
    }
  }, []);

  return {
    cancelingPromptId,
    clearRevertPrefill,
    handleCancelPendingPrompt,
    handleCancelRevert,
    handleRevertMessage,
    isCancelingRevert,
  };
}
