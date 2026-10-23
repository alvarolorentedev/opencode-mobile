import type { Message, Part } from '@/lib/opencode/types';

export type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

export type TranscriptDetail =
  | { id: string; kind: 'reasoning'; label: string; body: string; durationMs?: number }
  | { id: string; kind: 'tool'; tool: string; command?: string; label: string; body: string; status: string }
  | { id: string; kind: 'patch'; label: string; body: string }
  | { id: string; kind: 'file'; label: string; body: string; uri?: string; mime?: string; filename?: string }
  | { id: string; kind: 'retry'; label: string; body: string }
  | { id: string; kind: 'compaction'; label: string; body: string };

export type TranscriptEntry = {
  id: string;
  role: Message['role'];
  createdAt: number;
  text: string;
  details: TranscriptDetail[];
  error?: string;
};
