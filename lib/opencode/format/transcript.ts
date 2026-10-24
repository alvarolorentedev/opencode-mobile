import { getMessageError, getToolBody, getToolCommand, getToolPresentation, getToolTitle } from './tool';
import type { SessionMessageRecord, TranscriptDetail, TranscriptEntry } from './types';

const transcriptEntryCache = new WeakMap<SessionMessageRecord, TranscriptEntry>();

export function toTranscriptEntry(record: SessionMessageRecord): TranscriptEntry {
  const cached = transcriptEntryCache.get(record);
  if (cached) {
    return cached;
  }

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
        const start = part.time?.start;
        const end = part.time?.end;
        details.push({
          id,
          kind: 'reasoning',
          label: 'Reasoning',
          body: text,
          ...(typeof start === 'number' && typeof end === 'number'
            ? { durationMs: Math.max(0, end - start) }
            : {}),
        });
      }
      return;
    }

    if (part.type === 'tool') {
      const presentation = getToolPresentation(part);
      details.push({
        id,
        kind: 'tool',
        tool: part.tool,
        command: getToolCommand(part),
        label: getToolTitle(part),
        body: getToolBody(part),
        status: part.state.status,
        ...presentation,
      });
      if (part.state.status === 'completed') {
        part.state.attachments?.forEach((attachment, attachmentIndex) => {
          details.push({
            id: `${id}-attachment-${attachmentIndex}`,
            kind: 'file',
            label: attachment.filename || 'Tool attachment',
            body: attachment.mime || 'Attachment',
            uri: attachment.url,
            mime: attachment.mime,
            filename: attachment.filename,
          });
        });
      }
      return;
    }

    if (part.type === 'patch') {
      details.push({
        id,
        kind: 'patch',
        label: `Patch ${part.files.length} ${part.files.length === 1 ? 'file' : 'files'}`,
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
        uri: part.url,
        mime: part.mime,
        filename: part.filename,
      });
      return;
    }

    if (part.type === 'retry') {
      details.push({
        id,
        kind: 'retry',
        label: `Retry ${part.attempt}`,
        body: 'data' in part.error && part.error.data && 'message' in part.error.data ? String(part.error.data.message) : 'Request failed',
      });
      return;
    }

    if (part.type === 'compaction') {
      details.push({
        id,
        kind: 'compaction',
        label: 'Context compaction',
        body: part.auto ? 'OpenCode compacted the session automatically.' : 'OpenCode compacted the session.',
      });
    }
  });

  const entry: TranscriptEntry = {
    id: record.info.id,
    role: record.info.role,
    createdAt: record.info.time.created,
    text: textBlocks.join('\n\n').trim(),
    details,
    error: getMessageError(record),
  };
  transcriptEntryCache.set(record, entry);
  return entry;
}
