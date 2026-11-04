import type { FilePartInput, TextPartInput } from '@/shared/protocol/opencode/message-types';

export type PromptAttachment = { uri: string; mime?: string; filename?: string };
export type PromptDelivery = 'steer' | 'queue';
export type PromptMention = { start: number; end: number; text: string };
export type PromptContextItem =
  | { kind: 'file'; path: string; token: string }
  | { kind: 'agent'; name: string; token: string }
  | { kind: 'skill'; id: string; name: string; token: string };
export type CommandOptions = {
  agent?: string;
  model?: string;
  variant?: string;
  messageId?: string;
  attachments?: PromptAttachment[];
  context?: PromptContextItem[];
};
export type PromptInput = {
  sessionID: string;
  parts: (TextPartInput | FilePartInput)[];
  agent?: string;
  model?: { providerID: string; modelID: string };
  system?: string;
  variant?: string;
  context?: PromptContextItem[];
};
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
// A server notice (for example a plugin command reply) that is waiting in the
// inbox for the next turn. It is display-only and must not resume the agent.
export type PendingNotice = {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  description?: string;
};

export type PromptInboxApi = {
  submit: (input: PromptInput, delivery: PromptDelivery) => Promise<PendingPrompt>;
  list: (sessionId: string) => Promise<PendingPrompt[]>;
  listNotices: (sessionId: string) => Promise<PendingNotice[]>;
  cancel: (sessionId: string, promptId: string) => Promise<void>;
};
