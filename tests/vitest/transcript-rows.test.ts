import { describe, expect, it, vi } from 'vitest';

import { buildTranscriptRows, type ActivityGroup } from '@/lib/opencode/transcript';
import type { TranscriptEntry } from '@/lib/opencode/format';

vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));

const message = (id: string, text: string): TranscriptEntry => ({ id, role: 'assistant', createdAt: 1, text, details: [] });

const toolEntry = (id: string, tool: string, detailId: string, command?: string, body = 'out', status = 'completed'): TranscriptEntry => ({
  id,
  role: 'assistant',
  createdAt: 1,
  text: '',
  details: [{ id: detailId, kind: 'tool', tool, command, label: tool, body, status }],
});

const reasoningEntry = (id: string, detailId: string, body = 'think'): TranscriptEntry => ({
  id,
  role: 'assistant',
  createdAt: 1,
  text: '',
  details: [{ id: detailId, kind: 'reasoning', label: 'Reasoning', body }],
});

const patchEntry = (id: string, detailId: string): TranscriptEntry => ({
  id,
  role: 'assistant',
  createdAt: 1,
  text: '',
  details: [{ id: detailId, kind: 'patch', label: 'Patch 2 files', body: 'a.ts\nb.ts' }],
});

const group = (row: ReturnType<typeof buildTranscriptRows>[number]): ActivityGroup => (row as Extract<typeof row, { type: 'activity' }>).group;

describe('transcript rows', () => {
  it('merges contiguous calls of different tools into one activity run', () => {
    const rows = buildTranscriptRows([toolEntry('m1', 'bash', 'd1', 'ls'), toolEntry('m2', 'grep', 'd2', 'rg x')], 'verbose');
    expect(rows).toHaveLength(1);
    expect(group(rows[0])).toMatchObject({ kind: 'activity', key: 'd1', callCount: 2, status: 'idle' });
    expect(group(rows[0]).items).toHaveLength(2);
    expect(group(rows[0]).tools).toEqual([{ name: 'bash', count: 1 }, { name: 'grep', count: 1 }]);
  });

  it('keeps reasoning and tools in one run in wire order', () => {
    const rows = buildTranscriptRows([
      reasoningEntry('m1', 'r1'),
      toolEntry('m1', 'bash', 'd1'),
      reasoningEntry('m2', 'r2'),
      toolEntry('m2', 'bash', 'd2'),
    ], 'verbose');
    expect(rows).toHaveLength(1);
    expect(group(rows[0]).callCount).toBe(2);
    expect(group(rows[0]).tools).toEqual([{ name: 'bash', count: 2 }]);
    expect(group(rows[0]).items.map((item) => item.id)).toEqual(['r1', 'd1', 'r2', 'd2']);
  });

  it('breaks a run at a message bubble', () => {
    const rows = buildTranscriptRows([toolEntry('m1', 'bash', 'd1'), message('m2', 'hi'), toolEntry('m3', 'bash', 'd3')], 'verbose');
    expect(rows.map((row) => row.type)).toEqual(['activity', 'message', 'activity']);
  });

  it('counts hidden file tools without adding duplicate child rows', () => {
    const rows = buildTranscriptRows([
      toolEntry('m1', 'bash', 'd1'),
      toolEntry('m2', 'edit', 'd2'),
      toolEntry('m3', 'bash', 'd3'),
    ], 'verbose');
    expect(rows).toHaveLength(1);
    expect(group(rows[0]).callCount).toBe(3);
    expect(group(rows[0]).tools).toEqual([{ name: 'bash', count: 2 }, { name: 'edit', count: 1 }]);
    expect(group(rows[0]).items.map((item) => item.id)).toEqual(['d1', 'd3']);
  });

  it('drops runs that only contain hidden tools', () => {
    expect(buildTranscriptRows([toolEntry('m1', 'edit', 'd1')], 'verbose')).toEqual([]);
  });

  it('does not surface tools at basic verbosity', () => {
    expect(buildTranscriptRows([toolEntry('m1', 'bash', 'd1')], 'basic')).toEqual([]);
  });

  it('groups contiguous reasoning from the reasoning level', () => {
    const rows = buildTranscriptRows([reasoningEntry('m1', 'r1'), reasoningEntry('m2', 'r2')], 'reasoning');
    expect(rows).toHaveLength(1);
    expect(group(rows[0])).toMatchObject({ kind: 'activity', key: 'r1', callCount: 0, status: 'idle' });
    expect(group(rows[0]).items).toHaveLength(2);
    expect(group(rows[0]).tools).toEqual([]);
  });

  it('renders patch-only messages as activity rows at verbose detail', () => {
    const rows = buildTranscriptRows([patchEntry('m1', 'p1')], 'verbose');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('activity');
    expect(group(rows[0]).items[0]).toMatchObject({ kind: 'patch', id: 'p1' });
    expect(buildTranscriptRows([patchEntry('m1', 'p1')], 'reasoning')).toEqual([]);
  });

  it('marks a run running while any tool is active and error when one fails', () => {
    const running = buildTranscriptRows([toolEntry('m1', 'bash', 'd1', 'pnpm test', 'out', 'running')], 'verbose');
    expect(group(running[0]).status).toBe('running');

    const failed = buildTranscriptRows([
      toolEntry('m1', 'bash', 'd1', 'pnpm test', 'out', 'running'),
      toolEntry('m2', 'bash', 'd2', 'pnpm lint', 'boom', 'error'),
    ], 'verbose');
    expect(group(failed[0]).status).toBe('error');
  });

  it('keeps a text bubble before its own activity run', () => {
    const entry = toolEntry('m1', 'bash', 'd1');
    entry.text = 'text';
    const rows = buildTranscriptRows([entry, toolEntry('m2', 'bash', 'd2')], 'verbose');
    expect(rows.map((row) => row.type)).toEqual(['message', 'activity']);
    expect(group(rows[1]).items).toHaveLength(2);
  });
});
