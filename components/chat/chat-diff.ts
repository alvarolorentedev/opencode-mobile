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

export function buildLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const rowCount = beforeLines.length;
  const columnCount = afterLines.length;
  const table = Array.from({ length: rowCount + 1 }, () => Array<number>(columnCount + 1).fill(0));

  for (let row = rowCount - 1; row >= 0; row -= 1) {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      table[row][column] =
        beforeLines[row] === afterLines[column]
          ? table[row + 1][column + 1] + 1
          : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }

  const result: DiffLine[] = [];
  let row = 0;
  let column = 0;
  let leftNumber = 1;
  let rightNumber = 1;

  while (row < rowCount && column < columnCount) {
    if (beforeLines[row] === afterLines[column]) {
      result.push({
        kind: 'context',
        leftNumber,
        rightNumber,
        text: beforeLines[row],
      });
      row += 1;
      column += 1;
      leftNumber += 1;
      rightNumber += 1;
      continue;
    }

    if (table[row + 1][column] >= table[row][column + 1]) {
      result.push({
        kind: 'removed',
        leftNumber,
        text: beforeLines[row],
      });
      row += 1;
      leftNumber += 1;
      continue;
    }

    result.push({
      kind: 'added',
      rightNumber,
      text: afterLines[column],
    });
    column += 1;
    rightNumber += 1;
  }

  while (row < rowCount) {
    result.push({
      kind: 'removed',
      leftNumber,
      text: beforeLines[row],
    });
    row += 1;
    leftNumber += 1;
  }

  while (column < columnCount) {
    result.push({
      kind: 'added',
      rightNumber,
      text: afterLines[column],
    });
    column += 1;
    rightNumber += 1;
  }

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
