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
  // queued: left the device while offline; flush reconciles before admitting.
  // uncertain: the request may have reached the server before the connection
  // failed; never retry automatically.
  state: 'sending' | 'waiting' | 'queued' | 'uncertain';
};

export type PromptInboxApi = {
  submit: (input: PromptInput, delivery: PromptDelivery) => Promise<PendingPrompt>;
  list: (sessionId: string) => Promise<PendingPrompt[]>;
  cancel: (sessionId: string, promptId: string) => Promise<void>;
};
