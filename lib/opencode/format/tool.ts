import type { Part, ToolPart } from '@/lib/opencode/types';
import type { SessionMessageRecord } from './types';

export function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function isCompletedToolPart(
  part: Part,
): part is ToolPart & { state: Extract<ToolPart['state'], { status: 'completed' }> } {
  return part.type === 'tool' && part.state.status === 'completed';
}

export function getToolTitle(part: ToolPart) {
  return 'title' in part.state && part.state.title ? part.state.title : part.tool;
}

export function getToolCommand(part: ToolPart) {
  const command = part.state.input?.command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

export function getToolBody(part: ToolPart) {
  if ('error' in part.state && part.state.error) {
    return part.state.error;
  }

  if ('output' in part.state && part.state.output) {
    return part.state.output;
  }

  if ('metadata' in part && part.metadata) {
    return JSON.stringify(part.metadata, null, 2);
  }

  return 'No output';
}

export function getMessageError(record: SessionMessageRecord) {
  if (record.info.role !== 'assistant' || !('error' in record.info) || !record.info.error) {
    return undefined;
  }

  const data = record.info.error.data;
  const message = data && 'message' in data ? String(data.message) : 'Request failed';
  return `${record.info.error.name}: ${message}`;
}
