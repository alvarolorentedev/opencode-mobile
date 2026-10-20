import type { FilePartInput, TextPartInput } from './message-types';

export type PromptAttachment = { uri: string; mime?: string; filename?: string };
export type PromptDelivery = 'steer' | 'queue';
export type PromptInput = { sessionID: string; parts: (TextPartInput | FilePartInput)[]; agent?: string; model?: { providerID: string; modelID: string }; system?: string; variant?: string };
export type PendingPrompt = {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  attachments: PromptAttachment[];
  delivery: PromptDelivery;
  state: 'sending' | 'waiting';
};

export type PromptInboxApi = {
  submit: (input: PromptInput, delivery: PromptDelivery) => Promise<PendingPrompt>;
  list: (sessionId: string) => Promise<PendingPrompt[]>;
  cancel: (sessionId: string, promptId: string) => Promise<void>;
};
