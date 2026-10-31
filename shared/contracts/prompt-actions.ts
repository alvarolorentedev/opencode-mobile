export type SendPrompt = (sessionId: string, prompt: string, attachments?: { uri: string; mime?: string; filename?: string }[], context?: import('@/shared/protocol/opencode/prompt-inbox').PromptContextItem[]) => Promise<boolean>;

export type SendingState = {
    sessionId?: string;
    active: boolean;
  };
