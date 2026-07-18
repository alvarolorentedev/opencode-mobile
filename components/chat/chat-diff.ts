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
  let prefixLength = 0;
  while (prefixLength < beforeLines.length && prefixLength < afterLines.length && beforeLines[prefixLength] === afterLines[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - suffixLength - 1] === afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  // ponytail: treat multiple separated edits as one changed block; use Myers only if finer hunks become necessary.
  const result: DiffLine[] = [];

  beforeLines.slice(0, prefixLength).forEach((text, index) => {
    result.push({ kind: 'context', leftNumber: index + 1, rightNumber: index + 1, text });
  });
  beforeLines.slice(prefixLength, beforeLines.length - suffixLength).forEach((text, index) => {
    result.push({ kind: 'removed', leftNumber: prefixLength + index + 1, text });
  });
  afterLines.slice(prefixLength, afterLines.length - suffixLength).forEach((text, index) => {
    result.push({ kind: 'added', rightNumber: prefixLength + index + 1, text });
  });
  beforeLines.slice(beforeLines.length - suffixLength).forEach((text, index) => {
    result.push({
      kind: 'context',
      leftNumber: beforeLines.length - suffixLength + index + 1,
      rightNumber: afterLines.length - suffixLength + index + 1,
      text,
    });
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
