import { describe, expect, it } from 'vitest';

import { buildPatchFromContents, toFileDiff, toFileDiffs } from '@/lib/opencode/diff';

describe('file diff normalization', () => {
  it('keeps a native V2 patch and its totals', () => {
    expect(toFileDiff({ file: 'a.ts', patch: '@@ -1,1 +1,1 @@\n-old\n+new', additions: 1, deletions: 1, status: 'modified' }))
      .toEqual({ file: 'a.ts', patch: '@@ -1,1 +1,1 @@\n-old\n+new', additions: 1, deletions: 1, status: 'modified' });
  });

  it('builds a patch from V1 before/after contents and keeps server totals', () => {
    const diff = toFileDiff({
      file: 'app/(tabs)/index.tsx',
      before: 'export default function OldScreen() {}\n',
      after: 'export default function ChatLandingScreen() {\n  return null;\n}\n',
      additions: 6,
      deletions: 1,
    });
    expect(diff.patch).toBe([
      '--- a/app/(tabs)/index.tsx',
      '+++ b/app/(tabs)/index.tsx',
      '@@ -1,1 +1,3 @@',
      '-export default function OldScreen() {}',
      '+export default function ChatLandingScreen() {',
      '+  return null;',
      '+}',
    ].join('\n'));
    expect(diff.additions).toBe(6);
    expect(diff.deletions).toBe(1);
    expect(diff.status).toBeUndefined();
  });

  it('treats the common prefix and suffix as context and the middle as one changed block', () => {
    expect(buildPatchFromContents('a.ts', 'one\ntwo\nthree\n', 'one\nchanged\nthree\n')).toBe([
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+changed',
      ' three',
    ].join('\n'));
  });

  it('derives totals from the patch when a server omits them', () => {
    const diff = toFileDiff({ file: 'c.ts', before: 'one\ntwo\n', after: 'one\nthree\n' });
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it('falls back to contents when a server sends an empty patch', () => {
    expect(toFileDiff({ file: 'd.ts', patch: '', before: 'x\n', after: 'y\n' }).patch).toContain('@@ -1,1 +1,1 @@');
  });

  it('leaves a patch empty when the server exposed no content', () => {
    const diff = toFileDiff({ file: 'b.ts', additions: 3, deletions: 2 });
    expect(diff.patch).toBe('');
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(2);
  });

  it('reports no patch for unchanged contents', () => {
    expect(buildPatchFromContents('f.ts', 'same\n', 'same\n')).toBe('');
  });

  it('normalizes non-arrays to an empty list', () => {
    expect(toFileDiffs(undefined)).toEqual([]);
    expect(toFileDiffs({ data: [] })).toEqual([]);
    expect(toFileDiffs([{ file: 'e.ts' }])).toEqual([{ file: 'e.ts', patch: '', additions: 0, deletions: 0 }]);
  });
});
