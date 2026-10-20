import { describe, expect, it, vi } from 'vitest';

import { buildTranscriptRows, type DetailGroup } from '@/lib/opencode/transcript';
import type { TranscriptEntry } from '@/lib/opencode/format';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

const message = (id: string, text: string): TranscriptEntry => ({ id, role: 'assistant', createdAt: 1, text, details: [] });

const toolEntry = (id: string, tool: string, detailId: string, command?: string, body = 'out'): TranscriptEntry => ({
  id,
  role: 'assistant',
  createdAt: 1,
  text: '',
  details: [{ id: detailId, kind: 'tool', tool, command, label: tool, body, status: 'completed' }],
});

const reasoningEntry = (id: string, detailId: string, body = 'think'): TranscriptEntry => ({
  id,
  role: 'assistant',
  createdAt: 1,
  text: '',
  details: [{ id: detailId, kind: 'reasoning', label: 'Reasoning', body }],
});

const group = (row: ReturnType<typeof buildTranscriptRows>[number]): DetailGroup => (row as Extract<typeof row, { type: 'details' }>).group;

describe('transcript rows', () => {
  it('merges contiguous calls of the same tool across entries with a stable key', () => {
    const rows = buildTranscriptRows([toolEntry('m1', 'bash', 'd1', 'ls'), toolEntry('m2', 'bash', 'd2', 'pwd')], 'verbose');
    expect(rows).toHaveLength(1);
    expect(group(rows[0])).toMatchObject({ kind: 'tool', tool: 'bash', key: 'd1' });
    expect(group(rows[0]).details).toHaveLength(2);
  });

  it('breaks a group at a message bubble', () => {
    const rows = buildTranscriptRows([toolEntry('m1', 'bash', 'd1'), message('m2', 'hi'), toolEntry('m3', 'bash', 'd3')], 'verbose');
    expect(rows.map((row) => row.type)).toEqual(['details', 'message', 'details']);
  });

  it('skips hidden edit tools without splitting a visible shell group', () => {
    const rows = buildTranscriptRows([toolEntry('m1', 'bash', 'd1'), toolEntry('m2', 'edit', 'd2'), toolEntry('m3', 'bash', 'd3')], 'verbose');
    expect(rows).toHaveLength(1);
    expect(group(rows[0]).details).toHaveLength(2);
  });

  it('drops entries that only contain hidden tools', () => {
    expect(buildTranscriptRows([toolEntry('m1', 'edit', 'd1')], 'verbose')).toEqual([]);
  });

  it('does not surface tools at basic verbosity', () => {
    expect(buildTranscriptRows([toolEntry('m1', 'bash', 'd1')], 'basic')).toEqual([]);
  });

  it('groups contiguous reasoning from the reasoning level', () => {
    const rows = buildTranscriptRows([reasoningEntry('m1', 'r1'), reasoningEntry('m2', 'r2')], 'reasoning');
    expect(rows).toHaveLength(1);
    expect(group(rows[0])).toMatchObject({ kind: 'reasoning', key: 'r1' });
    expect(group(rows[0]).details).toHaveLength(2);
  });

  it('keeps a text bubble before its own group', () => {
    const entry = toolEntry('m1', 'bash', 'd1');
    entry.text = 'text';
    const rows = buildTranscriptRows([entry, toolEntry('m2', 'bash', 'd2')], 'verbose');
    expect(rows.map((row) => row.type)).toEqual(['message', 'details']);
    expect(group(rows[1]).details).toHaveLength(2);
  });
});
