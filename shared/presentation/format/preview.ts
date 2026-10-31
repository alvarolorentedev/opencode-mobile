import type { Part, Session } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format/types';
import { compactText, getMessageError, getToolTitle, isCompletedToolPart } from '@/shared/presentation/format/tool';

export function getSessionSubtitle(session: Session) {
  const summary = session.summary;
  if (!summary) {
    return 'No file changes recorded yet';
  }

  return `${summary.files} files changed, +${summary.additions} / -${summary.deletions}`;
}

function getPrimaryText(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text')
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
