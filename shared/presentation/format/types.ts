import type { Message, Part } from '@/shared/protocol/opencode/types';

export type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

export type TranscriptFileDiff = {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
};

export type TranscriptDetail =
  | { id: string; kind: 'reasoning'; label: string; body: string; durationMs?: number }
  | {
      id: string;
      kind: 'tool';
      tool: string;
      command?: string;
      label: string;
      body: string;
      status: string;
      path?: string;
      pattern?: string;
      include?: string;
      offset?: number;
      limit?: number;
      matchCount?: number;
      files?: TranscriptFileDiff[];
    }
  | { id: string; kind: 'patch'; label: string; body: string }
  | { id: string; kind: 'file'; label: string; body: string; uri?: string; mime?: string; filename?: string }
  | { id: string; kind: 'retry'; label: string; body: string }
  | { id: string; kind: 'compaction'; status: 'running' | 'completed' | 'failed'; inputTokens?: number; outputTokens?: number };

export type TranscriptEntry = {
  id: string;
  role: Message['role'];
  createdAt: number;
  text: string;
  details: TranscriptDetail[];
  error?: string;
  // A server notice, not a model reply. It must not feed read-aloud/voice.
  notice?: boolean;
  // The model that produced an assistant message. Auto-routing switches the
  // session model per turn, so this is the only per-reply record of the choice.
  model?: { providerID: string; modelID: string; variant?: string };
};
