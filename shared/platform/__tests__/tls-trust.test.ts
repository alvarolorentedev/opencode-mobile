import { describe, expect, it, vi } from 'vitest';

import { connectionOrigin, ensureConnectionTrust, isTlsTrustSupported, probeConnectionTrust, withTemporaryTrust } from '@/shared/platform/tls-trust';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('tls trust platform wrapper', () => {
  it('normalizes the connection origin with the default port', () => {
    expect(connectionOrigin('https://example.test/api')).toBe('example.test:443');
    expect(connectionOrigin('https://example.test:8443/proxy')).toBe('example.test:8443');
    expect(connectionOrigin('http://192.168.1.10:4096')).toBe('192.168.1.10:4096');
    expect(connectionOrigin('http://[fd00::1]:4096')).toBe('[fd00::1]:4096');
    expect(connectionOrigin('not a url')).toBeUndefined();
  });

  it('is unsupported without a native module', async () => {
    expect(isTlsTrustSupported()).toBe(false);
    await expect(ensureConnectionTrust(undefined)).resolves.toBeUndefined();
    await expect(withTemporaryTrust(undefined, async () => 'ok')).resolves.toBe('ok');
    await expect(probeConnectionTrust({ serverUrl: 'https://example.test', username: '', password: '', directory: '' })).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });
});
