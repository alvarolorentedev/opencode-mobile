import { describe, expect, it } from 'vitest';

import { buildDiffDisplayRows, buildDiffList } from '@/features/chat/ui/chat-diff';
import type { FileDiff } from '@/shared/protocol/opencode/types';

const diffs: FileDiff[] = [
  { file: 'a.ts', patch: '@@ -1 +1 @@\n-old\n+new', additions: 1, deletions: 1 },
  { file: 'b.ts', patch: '@@ -1 +1 @@\n-before\n+after', additions: 1, deletions: 1 },
];

describe('diff display rows', () => {
  it('flattens patch lines into one row per line', () => {
    const rows = buildDiffDisplayRows('@@ -1,2 +1,2 @@\n-old\n+new\n same');
    const lines = rows.flatMap((row) => row.type === 'line' ? [`${row.line.kind}:${row.line.text}`] : []);
    expect(lines).toEqual(['removed:old', 'added:new', 'context:same']);
  });

  it('keeps long context runs as collapsed rows', () => {
    const patch = ['@@ -1,20 +1,20 @@', ...Array.from({ length: 20 }, (_, index) => ` line ${index + 1}`), '+new'].join('\n');
    const collapsed = buildDiffDisplayRows(patch).filter((row) => row.type === 'collapsed');
    expect(collapsed).toHaveLength(1);
    if (collapsed[0]?.type === 'collapsed') expect(collapsed[0].block.hiddenCount).toBe(17);
  });

  it('returns no rows for a patch without hunks', () => {
    expect(buildDiffDisplayRows('')).toEqual([]);
  });
});

describe('diff list rows', () => {
  it('keeps collapsed files to one row and marks every file header sticky', () => {
    const { rows, stickyHeaderIndices } = buildDiffList(diffs, 'turn', 'diff:turn:b.ts');
    expect(rows.map((row) => row.type)).toEqual(['file', 'file', 'line', 'line']);
    expect(stickyHeaderIndices).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ type: 'file', accordionId: 'diff:turn:a.ts', expanded: false });
    expect(rows[1]).toMatchObject({ type: 'file', accordionId: 'diff:turn:b.ts', expanded: true });
  });

  it('keeps an expanded file with no patch content visible', () => {
    const { rows } = buildDiffList([{ file: 'empty.ts', additions: 0, deletions: 0 }], 'turn', 'diff:turn:empty.ts');
    expect(rows).toEqual([
      { type: 'file', key: 'diff:turn:empty.ts:header:0', accordionId: 'diff:turn:empty.ts', diff: { file: 'empty.ts', additions: 0, deletions: 0 }, expanded: true },
      { type: 'empty', key: 'diff:turn:empty.ts:empty', messageKey: 'chat:cards.previewUnavailable' },
    ]);
  });

  it('falls back to an index for a diff without a filename', () => {
    const { rows } = buildDiffList([{ additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+new' }], 'branch');
    expect(rows[0]).toMatchObject({ type: 'file', accordionId: 'diff:branch:file-0', expanded: false });
  });
});
