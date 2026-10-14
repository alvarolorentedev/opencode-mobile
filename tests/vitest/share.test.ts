import { describe, expect, it, vi } from 'vitest';

import {
  MAX_SHARE_ITEMS,
  MAX_SHARE_TEXT,
  parseIncomingShare,
} from '@/lib/share/parse';

vi.mock('expo/fetch', () => ({ fetch: (...args: any[]) => (globalThis.fetch as any)(...args) }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

describe('incoming share parsing', () => {
  it('returns null when nothing usable was shared', () => {
    expect(parseIncomingShare([])).toBeNull();
    expect(parseIncomingShare([{ value: '   ', shareType: 'text' }])).toBeNull();
  });

  it('collects text and a link', () => {
    const payload = parseIncomingShare([
      { value: 'hello world', shareType: 'text', contentType: 'text' },
      { value: 'https://example.com', shareType: 'url', contentType: 'website' },
    ]);
    expect(payload?.text).toBe('hello world');
    expect(payload?.url).toBe('https://example.com');
    expect(payload?.attachments).toEqual([]);
    expect(payload?.skipped).toEqual([]);
  });

  it('maps file-like payloads to attachments and drops oversize or unsafe items', () => {
    const payload = parseIncomingShare([
      { contentUri: 'file:///cache/photo.jpg', contentType: 'image', contentMimeType: 'image/jpeg', originalName: 'photo.jpg', contentSize: 2048 },
      { contentUri: 'file:///cache/big.pdf', contentType: 'file', contentMimeType: 'application/pdf', originalName: 'big.pdf', contentSize: 20 * 1024 * 1024 },
      { contentUri: 'javascript:alert(1)', contentType: 'file', originalName: 'evil.bin' },
    ]);
    expect(payload?.attachments).toEqual([
      { uri: 'file:///cache/photo.jpg', mime: 'image/jpeg', filename: 'photo.jpg' },
    ]);
    expect(payload?.skipped).toEqual(['big.pdf', 'evil.bin']);
  });

  it('caps the number of staged items', () => {
    const many = Array.from({ length: MAX_SHARE_ITEMS + 3 }, (_, index) => ({
      value: `item ${index}`,
      shareType: 'text' as const,
    }));
    expect(parseIncomingShare(many)?.text?.split('\n\n')).toHaveLength(MAX_SHARE_ITEMS);
  });

  it('caps the shared text length', () => {
    const payload = parseIncomingShare([{ value: 'a'.repeat(MAX_SHARE_TEXT + 50), shareType: 'text' }]);
    expect(payload?.text?.length).toBe(MAX_SHARE_TEXT);
  });
});
