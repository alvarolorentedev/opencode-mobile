import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { findByConnectionReference, privateConnectionReference } from '../private-connection-reference';

const crypto = vi.hoisted(() => ({ digest: vi.fn() }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: crypto.digest,
}));

describe('private native connection references', () => {
  it('uses a deterministic one-way reference rather than exposing a server identity', async () => {
    crypto.digest.mockImplementation(async (_algorithm, value: string) => createHash('sha256').update(value).digest('hex'));
    const scope = Buffer.from('https://private-server.example\nalice').toString('base64');
    const reference = await privateConnectionReference(scope);
    expect(reference).toMatch(/^activity-sha256:[a-f0-9]{64}$/);
    expect(reference).not.toContain(scope);
    expect(reference).not.toContain('private-server');
    expect(await privateConnectionReference(scope)).toBe(reference);
  });

  it('resolves only a matching existing scope and preserves legacy links', async () => {
    crypto.digest.mockImplementation(async (_algorithm, value: string) => createHash('sha256').update(value).digest('hex'));
    const entries = [{ scope: 'first' }, { scope: 'second' }];
    const reference = await privateConnectionReference('second');
    expect(await findByConnectionReference(entries, reference, (entry) => entry.scope)).toBe(entries[1]);
    expect(await findByConnectionReference(entries, 'first', (entry) => entry.scope)).toBe(entries[0]);
    expect(await findByConnectionReference(entries, await privateConnectionReference('deleted'), (entry) => entry.scope)).toBeUndefined();
  });

  it('rejects arbitrary and malformed references without invoking crypto', async () => {
    crypto.digest.mockClear();
    for (const reference of ['https://untrusted.example', 'activity-sha256:', 'activity-sha256:not-a-digest']) {
      expect(await findByConnectionReference([{ scope: 'known' }], reference, (entry) => entry.scope)).toBeUndefined();
    }
    expect(crypto.digest).not.toHaveBeenCalled();
  });

  it('fails closed if the digest provider fails', async () => {
    crypto.digest.mockRejectedValueOnce(new Error('crypto unavailable'));
    await expect(privateConnectionReference('private-scope')).rejects.toThrow('crypto unavailable');
  });
});
