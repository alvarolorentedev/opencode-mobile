import { describe, expect, it } from 'vitest';

import { buildDiffDisplayRows } from '@/features/chat/ui/chat-diff';

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
