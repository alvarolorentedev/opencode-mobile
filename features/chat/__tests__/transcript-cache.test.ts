import { describe, expect, it } from 'vitest';

import { persistTranscriptCache } from '@/features/chat/services/transcript-cache';
import type { SessionMessageRecord } from '@/shared/presentation/format';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
  };
}

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
  it('keeps the newest small records and never stores an inline-media record', async () => {
    const cache = storage();
    await persistTranscriptCache('scope', '/repo', 's', [text('a'), video('video'), text('b')], cache);
    const raw = [...cache.values.values()][0];
    const stored = JSON.parse(raw) as { records: SessionMessageRecord[] };
    expect(stored.records.map((record) => record.info.id)).toEqual(['b']);
  });
});
