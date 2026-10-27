import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { ConnectionState, ConversationInputPhase } from '@/providers/opencode-provider-types';
import { applyConversationFeedback } from '@/providers/conversation/feedback';

export function useConversationConnectionFeedback({
  connection,
  conversationPhase,
  setConversationFeedback,
  setConversationFeedbackAction,
}: {
  connection: ConnectionState;
  conversationPhase: ConversationInputPhase;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
}) {
  useEffect(() => {
    if (conversationPhase === 'off' || connection.status === 'connected') {
      return;
    }

    applyConversationFeedback(
      setConversationFeedback,
      setConversationFeedbackAction,
      connection.message || 'OpenCode disconnected. Conversation mode will resume when the connection returns.',
    );
  }, [connection.message, connection.status, conversationPhase, setConversationFeedback, setConversationFeedbackAction]);

  useEffect(() => {
    if (connection.status !== 'connected') {
      return;
    }

    setConversationFeedback((current) => {
      if (!current) {
        return current;
      }

      if (current === connection.message || current.includes('resume when the connection returns')) {
        return undefined;
      }

      return current;
    });
  }, [connection.message, connection.status, setConversationFeedback]);
}
