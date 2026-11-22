import { describe, expect, it } from 'vitest';

import { compactTranscriptSnapshot } from '@/shared/server-data/transcript-snapshots';
import type { SessionMessageRecord } from '@/shared/presentation/format';

function text(id: string): SessionMessageRecord {
  return {
    info: { id, sessionID: 's', role: 'user', time: { created: 1 } },
    parts: [{ id: `${id}-text`, sessionID: 's', messageID: id, type: 'text', text: id }],
  };
}

function video(id: string): SessionMessageRecord {
  return {
    info: { id, sessionID: 's', role: 'user', time: { created: 2 } },
    parts: [{ id: `${id}-file`, sessionID: 's', messageID: id, type: 'file', url: `data:video/mp4;base64,${'A'.repeat(300_000)}`, mime: 'video/mp4', filename: 'clip.mp4' }],
  };
}

describe('transcript cache bounds', () => {
  it('keeps the newest small records and never stores an inline-media record', () => {
    const stored = compactTranscriptSnapshot([{ records: [text('a'), video('video'), text('b')] }]);
    expect(stored.records.map((record) => record.info.id)).toEqual(['b']);
  });

  it('keeps text from a mixed prompt while dropping inline and transient media', () => {
    const record = text('prompt');
    const file = video('prompt').parts[0];
    if (file.type !== 'file') throw new Error('Expected a file part.');
    record.parts.push({ ...file, url: 'data:text/plain;base64,YQ==' }, { ...file, url: 'blob:https://example.test/part' });
    const stored = compactTranscriptSnapshot([{ records: [record] }]);
    expect(stored.records).toEqual([text('prompt')]);
    expect(JSON.stringify(stored)).not.toMatch(/data:|blob:/);
  });
});
