export type ConnectionCertificateKind = 'ca' | 'self-signed' | 'server';
export type CertificateFailureReason = 'untrusted' | 'expired' | 'hostname-mismatch' | 'invalid';

export type ConnectionCertificate = {
  // Normalized PEM bundle. One or more certificates may be present.
  pem: string;
  // SHA-256 of the first certificate in the bundle, lowercase hex.
  fingerprint: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  kind: ConnectionCertificateKind;
  count: number;
};

export const MAX_CERTIFICATE_BYTES = 64 * 1024;
const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';
const FINGERPRINT = /^[0-9a-f]{64}$/;

function stringValue(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : undefined;
}

function dateValue(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : undefined;
}

export function parseStoredConnectionCertificate(value: unknown): ConnectionCertificate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pem = typeof record.pem === 'string' ? record.pem : undefined;
  if (!pem || pem.length > MAX_CERTIFICATE_BYTES || !pem.includes(PEM_BEGIN) || !pem.includes(PEM_END)) return undefined;
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.toLowerCase() : undefined;
  if (!fingerprint || !FINGERPRINT.test(fingerprint)) return undefined;
  const subject = stringValue(record.subject, 4096);
  const issuer = stringValue(record.issuer, 4096);
  const notBefore = dateValue(record.notBefore);
  const notAfter = dateValue(record.notAfter);
  const kind = record.kind === 'ca' || record.kind === 'self-signed' || record.kind === 'server' ? record.kind : undefined;
  const count = typeof record.count === 'number' && Number.isInteger(record.count) && record.count > 0 && record.count <= 16 ? record.count : undefined;
  if (!subject || !issuer || !notBefore || !notAfter || !kind || !count) return undefined;
  return { pem, fingerprint, subject, issuer, notBefore, notAfter, kind, count };
}

export function hasConnectionCertificate(value: ConnectionCertificate | undefined): value is ConnectionCertificate {
  return Boolean(value && value.pem);
}

export function certificateFingerprintLabel(fingerprint: string) {
  return fingerprint.toUpperCase().match(/.{1,2}/g)?.join(':') ?? fingerprint.toUpperCase();
}
