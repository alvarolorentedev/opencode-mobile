import type { TranscriptEntry } from '@/shared/presentation/format';

import type { VoiceRecoveryAction } from '@/shared/platform/voice/speech-errors';

export type ConversationInputPhase = 'off' | 'armed' | 'listening' | 'confirming' | 'submitting';

export type ConversationReadbackPhase = 'idle' | 'waiting' | 'speaking';

export type ConversationConfirmationPhase = 'prompting' | 'listening' | 'editing' | 'expired';

export type ConversationPhase = ConversationInputPhase | 'waiting' | 'speaking';

export type ConversationConfirmationState = {
  active: boolean;
  phase: ConversationConfirmationPhase;
  text: string;
  heard?: string;
  error?: string;
  speaking: boolean;
  actions: {
    cancel: () => void;
    confirm: (text?: string) => void;
    edit: () => void;
    retry: () => void;
  };
};

export const CONVERSATION_KEEP_AWAKE_TAG = 'opencode-conversation-mode';

export const CONVERSATION_FINAL_RESULT_SETTLE_MS = 2200;

export const CONVERSATION_LISTENING_RESTART_MS = 350;

// How long the wake phrase leaves the command window open when nothing
// intelligible follows. Kept short so a false phrase detection re-arms instead
// of recording ambient conversation.
export const CONVERSATION_COMMAND_TIMEOUT_MS = 6000;

export type ConversationReadbackEntry = {
  entry: TranscriptEntry;
  completed: boolean;
};

export type ConversationState = {
  active: boolean;
  sessionId?: string;
  // `phase` is the derived label for existing UI surfaces. Input and readback
  // are independent, so consumers that need to distinguish them use these
  // fields directly.
  phase: ConversationPhase;
  inputPhase: ConversationInputPhase;
  readbackPhase: ConversationReadbackPhase;
  statusLabel?: string;
  feedback?: string;
  // Recovery action offered alongside `feedback` when it came from a voice
  // input failure.
  feedbackAction?: VoiceRecoveryAction;
  latestHeardText?: string;
  confirmation?: ConversationConfirmationState;
  isListening: boolean;
  level: number;
  wakePhrase: string;
  wakePhraseRequired: boolean;
};

export type ConversationContextValue = {
  conversation: ConversationState;
  clearConversationFeedback: () => void;
  toggleConversationMode: () => Promise<void>;
};
