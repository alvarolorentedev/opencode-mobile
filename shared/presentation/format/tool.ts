import type { Part, ToolPart } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord, TranscriptFileDiff } from '@/shared/presentation/format/types';

export function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function isCompletedToolPart(
  part: Part,
): part is ToolPart & { state: Extract<ToolPart['state'], { status: 'completed' }> } {
  return part.type === 'tool' && part.state.status === 'completed';
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  apply_patch: 'Patch',
  bash: 'Shell',
  edit: 'Edit',
  fetch: 'Fetch',
  fish: 'Shell',
  glob: 'Glob',
  grep: 'Grep',
  list: 'List',
  multiedit: 'Edit',
  patch: 'Patch',
  read: 'Read',
  search: 'Search',
  sh: 'Shell',
  shell: 'Shell',
  skill: 'Skill',
  task: 'Task',
  todowrite: 'Plan',
  webfetch: 'Fetch',
  websearch: 'Search',
  write: 'Write',
  zsh: 'Shell',
};

export function getToolDisplayName(tool: string) {
  const normalized = tool.trim().toLowerCase();
  if (!normalized) {
    return tool;
  }

  return TOOL_DISPLAY_NAMES[normalized] ?? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

const FILE_CHANGE_TOOL_NAMES = new Set(['apply_patch', 'edit', 'multiedit', 'patch', 'write']);

export function isFileChangeToolName(tool: string) {
  return FILE_CHANGE_TOOL_NAMES.has(tool.trim().toLowerCase());
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

export type ToolPresentation = {
  path?: string;
  pattern?: string;
  include?: string;
  offset?: number;
  limit?: number;
  matchCount?: number;
  files?: TranscriptFileDiff[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function countPatchLines(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function normalizeFileDiff(value: unknown): TranscriptFileDiff | undefined {
  const record = asRecord(value);
  const file = asString(record?.file);
  if (!file) return undefined;

  const patch = asString(record?.patch);
  const counted = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 };
  const additions = asNumber(record?.additions) ?? counted.additions;
  const deletions = asNumber(record?.deletions) ?? counted.deletions;
  if (additions === 0 && deletions === 0) return undefined;

  const status = record?.status;
  return {
    file,
    ...(patch ? { patch } : {}),
    additions,
    deletions,
    ...(status === 'added' || status === 'deleted' || status === 'modified' ? { status } : {}),
  };
}

function splitLines(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n').split('\n');
  if (normalized.length > 0 && normalized[normalized.length - 1] === '') normalized.pop();
  return normalized;
}

// Minimal one-hunk patch with three context lines. It is intentionally not a
// full LCS diff: the edit tool already supplies the exact replacement strings,
// and the one changed block renders the same information without pulling in a
// diff dependency for the transcript path.
function buildSimplePatch(file: string, before: string, after: string): TranscriptFileDiff | undefined {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  if (removed.length === 0 && added.length === 0) return undefined;

  const contextBefore = oldLines.slice(Math.max(0, prefix - 3), prefix);
  const contextAfter = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 3);
  const hunkStart = Math.max(0, prefix - contextBefore.length) + 1;
  const oldCount = contextBefore.length + removed.length + contextAfter.length;
  const newCount = contextBefore.length + added.length + contextAfter.length;
  const patch = [
    `@@ -${hunkStart},${oldCount} +${hunkStart},${newCount} @@`,
    ...contextBefore.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...contextAfter.map((line) => ` ${line}`),
  ].join('\n');

  return {
    file,
    patch,
    additions: added.length,
    deletions: removed.length,
    status: before.length === 0 ? 'added' : after.length === 0 ? 'deleted' : 'modified',
  };
}

function diffFromEditInput(input: Record<string, unknown>) {
  const path = asString(input.path);
  const before = asString(input.oldString);
  const after = asString(input.newString);
  if (!path || before === undefined || after === undefined) return undefined;
  return buildSimplePatch(path, before, after);
}

function diffFromWriteInput(input: Record<string, unknown>) {
  const path = asString(input.path);
  const content = asString(input.content);
  if (!path || content === undefined) return undefined;
  return buildSimplePatch(path, '', content);
}

function getToolMetadata(part: ToolPart) {
  const stateMetadata = 'metadata' in part.state ? asRecord(part.state.metadata) : undefined;
  return { ...(part.metadata ?? {}), ...(stateMetadata ?? {}) };
}

function deriveToolFiles(part: ToolPart, input: Record<string, unknown>) {
  const name = part.tool.trim().toLowerCase();
  if (name === 'multiedit' && Array.isArray(input.edits)) {
    return input.edits.flatMap((edit) => {
      const diff = diffFromEditInput(asRecord(edit) ?? {});
      return diff ? [diff] : [];
    });
  }

  if (name === 'edit') {
    const diff = diffFromEditInput(input);
    return diff ? [diff] : [];
  }

  if (name === 'write') {
    const diff = diffFromWriteInput(input);
    return diff ? [diff] : [];
  }

  return [];
}

export function getToolPresentation(part: ToolPart): ToolPresentation {
  const input = asRecord(part.state.input) ?? {};
  const metadata = getToolMetadata(part);
  const metadataFiles = Array.isArray(metadata.files)
    ? metadata.files.map(normalizeFileDiff).filter((file): file is TranscriptFileDiff => Boolean(file))
    : [];
  const files = metadataFiles.length > 0 ? metadataFiles : deriveToolFiles(part, input);
  const path = asString(input.path);
  const pattern = asString(input.pattern);
  const include = asString(input.include);
  const offset = asNumber(input.offset);
  const limit = asNumber(input.limit);
  const matchCount = asNumber(metadata.matches) ?? asNumber(metadata.count);

  return {
    ...(path !== undefined ? { path } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(include !== undefined ? { include } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(matchCount !== undefined ? { matchCount } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

export function getMessageError(record: SessionMessageRecord) {
  if (record.info.role !== 'assistant' || !('error' in record.info) || !record.info.error) {
    return undefined;
  }

  const data = record.info.error.data;
  const message = data && 'message' in data ? String(data.message) : 'Request failed';
  return `${record.info.error.name}: ${message}`;
}
