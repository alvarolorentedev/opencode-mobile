import { describe, expect, it } from 'vitest';

import { certificateFingerprintLabel, parseStoredConnectionCertificate } from '@/shared/contracts/connection-certificate';

const certificate = {
  pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  fingerprint: 'a'.repeat(64),
  subject: 'CN=OpenCode CA',
  issuer: 'CN=OpenCode CA',
  notBefore: '2026-01-01T00:00:00Z',
  notAfter: '2031-01-01T00:00:00Z',
  kind: 'ca',
  count: 1,
};

describe('connection certificate contract', () => {
  it('accepts a normalized stored certificate', () => {
    expect(parseStoredConnectionCertificate(certificate)).toEqual(certificate);
  });

  it('rejects malformed values instead of hydrating partial trust', () => {
    expect(parseStoredConnectionCertificate(undefined)).toBeUndefined();
    expect(parseStoredConnectionCertificate({ ...certificate, pem: 'not a certificate' })).toBeUndefined();
    expect(parseStoredConnectionCertificate({ ...certificate, fingerprint: 'abc' })).toBeUndefined();
    expect(parseStoredConnectionCertificate({ ...certificate, notAfter: 'not a date' })).toBeUndefined();
    expect(parseStoredConnectionCertificate({ ...certificate, kind: 'other' })).toBeUndefined();
    expect(parseStoredConnectionCertificate({ ...certificate, count: 0 })).toBeUndefined();
  });

  it('formats the SHA-256 fingerprint for inspection', () => {
    expect(certificateFingerprintLabel('aabbccdd')).toBe('AA:BB:CC:DD');
  });
});
