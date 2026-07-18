import type { Colors } from '@/constants/theme';

export type DiffLine = {
  kind: 'context' | 'added' | 'removed';
  leftNumber?: number;
  rightNumber?: number;
  text: string;
};

export type DiffBlock =
  | { type: 'lines'; lines: DiffLine[] }
  | { type: 'collapsed'; hiddenCount: number; startLine?: number; endLine?: number };

const DIFF_CONTEXT_LINES = 3;

export function buildPatchDiff(patch: string): DiffLine[] {
  const result: DiffLine[] = [];
  let leftNumber = 0;
  let rightNumber = 0;
  let inHunk = false;

  patch.split('\n').forEach((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      leftNumber = Number(hunk[1]);
      rightNumber = Number(hunk[2]);
      inHunk = true;
      return;
    }
    if (!inHunk || line.startsWith('\\ No newline')) return;

    const text = line.slice(1);
    if (line.startsWith('-')) {
      result.push({ kind: 'removed', leftNumber, text });
      leftNumber += 1;
    } else if (line.startsWith('+')) {
      result.push({ kind: 'added', rightNumber, text });
      rightNumber += 1;
    } else {
      result.push({ kind: 'context', leftNumber, rightNumber, text });
      leftNumber += 1;
      rightNumber += 1;
    }
  });

  return result;
}

export function getDiffPalette(kind: DiffLine['kind'], palette: (typeof Colors)['light']) {
  if (kind === 'added') {
    return {
      backgroundColor: 'rgba(86, 207, 142, 0.14)',
      accentColor: '#56cf8e',
    };
  }

  if (kind === 'removed') {
    return {
      backgroundColor: 'rgba(255, 107, 107, 0.14)',
      accentColor: palette.danger,
    };
  }

  return {
    backgroundColor: palette.background,
    accentColor: 'transparent',
  };
}

export function buildCollapsedDiffBlocks(lines: DiffLine[], contextSize = DIFF_CONTEXT_LINES): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].kind !== 'context') {
      const changedLines: DiffLine[] = [];
      while (index < lines.length && lines[index].kind !== 'context') {
        changedLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'lines', lines: changedLines });
      continue;
    }

    const contextStart = index;
    while (index < lines.length && lines[index].kind === 'context') {
      index += 1;
    }

    const contextLines = lines.slice(contextStart, index);
    const isLeading = contextStart === 0;
    const isTrailing = index === lines.length;

    if (contextLines.length <= contextSize * 2 || (isLeading && isTrailing)) {
      blocks.push({ type: 'lines', lines: contextLines });
      continue;
    }

    if (isLeading) {
      blocks.push({ type: 'lines', lines: contextLines.slice(0, contextSize) });
      blocks.push({
        type: 'collapsed',
        hiddenCount: contextLines.length - contextSize,
        startLine: contextLines[contextSize]?.leftNumber,
        endLine: contextLines[contextLines.length - 1]?.leftNumber,
      });
      continue;
    }

    if (isTrailing) {
      blocks.push({
        type: 'collapsed',
        hiddenCount: contextLines.length - contextSize,
        startLine: contextLines[0]?.leftNumber,
        endLine: contextLines[contextLines.length - contextSize - 1]?.leftNumber,
      });
      blocks.push({ type: 'lines', lines: contextLines.slice(-contextSize) });
      continue;
    }

    blocks.push({ type: 'lines', lines: contextLines.slice(0, contextSize) });
    blocks.push({
      type: 'collapsed',
      hiddenCount: contextLines.length - contextSize * 2,
      startLine: contextLines[contextSize]?.leftNumber,
      endLine: contextLines[contextLines.length - contextSize - 1]?.leftNumber,
    });
    blocks.push({ type: 'lines', lines: contextLines.slice(-contextSize) });
  }

  return blocks.filter((block) => block.type === 'lines' || block.hiddenCount > 0);
}
