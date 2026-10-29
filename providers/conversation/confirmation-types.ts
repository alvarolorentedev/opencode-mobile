import type { Dispatch, SetStateAction } from 'react';

import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type {
  ConnectionState,
  ConversationConfirmationPhase,
  ConversationInputPhase,
} from '@/providers/opencode-provider-types';

export const CONFIRMATION_ECHO_GUARD_MS = 300;
export const CONFIRMATION_LISTEN_TIMEOUT_MS = 15000;
export const CONFIRMATION_DISMISS_TIMEOUT_MS = 60000;
export const CONFIRMATION_RETRY_DELAY_MS = 300;
export const CONFIRMATION_PROMPT_SETTLE_MS = 120;
export const MAX_CONFIRMATION_ATTEMPTS = 2;

export type ConfirmationSource = 'system' | 'local';

export type PendingConfirmation = {
  id: number;
  text: string;
  source: ConfirmationSource;
  sessionId?: string;
  phase: ConversationConfirmationPhase;
  heard?: string;
  error?: string;
};

export type ConfirmationOptions = {
  chatPreferences: ChatPreferences;
  connectionStatus: ConnectionState['status'];
  conversationPhaseRef: { current: ConversationInputPhase };
  conversationSessionId?: string;
  rearmConversation: () => Promise<void>;
  retryCommand: () => Promise<boolean>;
  setConversationFeedback: Dispatch<SetStateAction<string | undefined>>;
  setConversationFeedbackAction: Dispatch<SetStateAction<VoiceRecoveryAction>>;
  setConversationLatestHeardText: Dispatch<SetStateAction<string | undefined>>;
  setConversationPhase: Dispatch<SetStateAction<ConversationInputPhase>>;
  startLocalConfirmation: () => Promise<boolean>;
  startSystemConfirmation: () => Promise<boolean>;
  stopLocalConfirmation: () => Promise<void>;
  stopSystemInput: () => void;
  submitCommand: (text: string) => void;
};
