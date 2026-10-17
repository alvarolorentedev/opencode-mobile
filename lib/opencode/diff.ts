import type { FileDiff } from './types';

const DIFF_STATUSES = ['added', 'deleted', 'modified'] as const;

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Split without a phantom trailing entry: "a\n" is one line, "" is none.
function toLines(value: string): string[] {
  return value ? value.replace(/\n$/, '').split('\n') : [];
}

// V1 reports whole-file `before`/`after` contents instead of a unified patch.
// Some V2 responses omit the patch the same way. Rebuild a single-hunk unified
// diff, keeping the common prefix and suffix as context and the changed middle
// as one block, so the viewer renders the same shape it renders for a server
// patch without dumping an entire unchanged file into the preview.
export function buildPatchFromContents(file: string | undefined, before: string, after: string): string {
  if (before === after) {
    return '';
  }
  const oldLines = toLines(before);
  const newLines = toLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldRange = oldLines.length ? `1,${oldLines.length}` : '0,0';
  const newRange = newLines.length ? `1,${newLines.length}` : '0,0';
  return [
    ...(file ? [`--- a/${file}`, `+++ b/${file}`] : []),
    `@@ -${oldRange} +${newRange} @@`,
    ...oldLines.slice(0, prefix).map((line) => ` ${line}`),
    ...oldLines.slice(prefix, oldLines.length - suffix).map((line) => `-${line}`),
    ...newLines.slice(prefix, newLines.length - suffix).map((line) => `+${line}`),
    ...(suffix ? oldLines.slice(oldLines.length - suffix).map((line) => ` ${line}`) : []),
  ].join('\n');
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

// V2 sends `{ file, patch, additions, deletions, status }`; V1 sends
// `{ file, before, after, additions, deletions }`. Normalize both so the diff
// viewer always receives a unified patch when the server exposed content. The
// server's totals win; they are derived from the patch only when it omits them.
export function toFileDiff(raw: unknown): FileDiff {
  const record = (raw ?? {}) as Record<string, unknown>;
  const file = asText(record.file);
  const before = asText(record.before);
  const after = asText(record.after);
  const patch = asText(record.patch) || (before !== undefined && after !== undefined ? buildPatchFromContents(file, before, after) : '');
  const counted = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 };
  const status = DIFF_STATUSES.find((value) => value === record.status);
  return {
    ...(file ? { file } : {}),
    patch,
    additions: asCount(record.additions) ?? counted.additions,
    deletions: asCount(record.deletions) ?? counted.deletions,
    ...(status ? { status } : {}),
  };
}

export function toFileDiffs(raw: unknown): FileDiff[] {
  return Array.isArray(raw) ? raw.map(toFileDiff) : [];
}
