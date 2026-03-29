import type { Message, Part, Session, ToolPart } from '@opencode-ai/sdk/client';

export type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

export type TranscriptDetail =
  | { id: string; kind: 'reasoning'; label: string; body: string }
  | { id: string; kind: 'tool'; label: string; body: string; status: string }
  | { id: string; kind: 'patch'; label: string; body: string }
  | { id: string; kind: 'file'; label: string; body: string }
  | { id: string; kind: 'subtask'; label: string; body: string };

export type TranscriptEntry = {
  id: string;
  role: Message['role'];
  createdAt: number;
  text: string;
  details: TranscriptDetail[];
  error?: string;
};

function isCompletedToolPart(
  part: Part,
): part is ToolPart & { state: Extract<ToolPart['state'], { status: 'completed' }> } {
  return part.type === 'tool' && part.state.status === 'completed';
}

function getToolTitle(part: ToolPart) {
  return 'title' in part.state && part.state.title ? part.state.title : part.tool;
}

function getToolBody(part: ToolPart) {
  if ('output' in part.state && part.state.output) {
    return part.state.output;
  }

  if ('metadata' in part && part.metadata) {
    return JSON.stringify(part.metadata, null, 2);
  }

  return 'No output';
}

function getMessageError(record: SessionMessageRecord) {
  if (record.info.role !== 'assistant' || !('error' in record.info) || !record.info.error) {
    return undefined;
  }

  return `${record.info.error.name}: ${
    'message' in record.info.error.data ? String(record.info.error.data.message) : 'Request failed'
  }`;
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatTimestamp(value: number) {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(value);
    }
  } catch {
    // Fall back below.
  }

  return new Date(value).toLocaleString();
}

export function formatRelativeTime(value: number) {
  const diffMs = value - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) {
    return 'just now';
  }

  if (Math.abs(diffMinutes) < 60) {
    return formatRelative(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatRelative(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return formatRelative(diffDays, 'day');
}

function formatRelative(value: number, unit: 'minute' | 'hour' | 'day') {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
    }
  } catch {
    // Fall back below.
  }

  if (value === 0) {
    return 'just now';
  }

  const absolute = Math.abs(value);
  const suffix = absolute === 1 ? unit : `${unit}s`;
  return value < 0 ? `${absolute} ${suffix} ago` : `in ${absolute} ${suffix}`;
}

export function getSessionSubtitle(session: Session) {
  const summary = session.summary;
  if (!summary) {
    return 'No file changes recorded yet';
  }

  return `${summary.files} files changed, +${summary.additions} / -${summary.deletions}`;
}

export function getPrimaryText(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text' || part.type === 'reasoning')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function getMessagePreview(record: SessionMessageRecord) {
  const primary = compactText(getPrimaryText(record.parts));
  if (primary) {
    return primary;
  }

  const completedTools = record.parts.filter(isCompletedToolPart);
  if (completedTools.length > 0) {
    return compactText(getToolTitle(completedTools[0]));
  }

  const error = getMessageError(record);
  if (error) {
    return error;
  }

  return record.info.role === 'user' ? 'Prompt sent' : 'Response ready';
}

export function getHistoryPreview(messages: SessionMessageRecord[]) {
  const latest = [...messages].reverse().find((record) => getMessagePreview(record));
  if (!latest) {
    return 'Start a new conversation';
  }

  return getMessagePreview(latest);
}

export function toTranscriptEntry(record: SessionMessageRecord): TranscriptEntry {
  const textBlocks: string[] = [];
  const details: TranscriptDetail[] = [];

  record.parts.forEach((part, index) => {
    const id = `${record.info.id}-${index}`;

    if (part.type === 'text') {
      const text = part.text.trim();
      if (text) {
        textBlocks.push(text);
      }
      return;
    }

    if (part.type === 'reasoning') {
      const text = part.text.trim();
      if (text) {
        details.push({
          id,
          kind: 'reasoning',
          label: 'Reasoning',
          body: text,
        });
      }
      return;
    }

    if (part.type === 'tool') {
      details.push({
        id,
        kind: 'tool',
        label: getToolTitle(part),
        body: getToolBody(part),
        status: part.state.status,
      });
      return;
    }

    if (part.type === 'patch') {
      details.push({
        id,
        kind: 'patch',
        label: `Patch ${part.files.length} files`,
        body: part.files.join('\n'),
      });
      return;
    }

    if (part.type === 'file') {
      details.push({
        id,
        kind: 'file',
        label: part.filename || 'File attachment',
        body: part.mime || 'Attachment',
      });
      return;
    }

    if (part.type === 'subtask') {
      details.push({
        id,
        kind: 'subtask',
        label: 'Subtask',
        body: part.description,
      });
    }
  });

  return {
    id: record.info.id,
    role: record.info.role,
    createdAt: record.info.time.created,
    text: textBlocks.join('\n\n').trim(),
    details,
    error: getMessageError(record),
  };
}
