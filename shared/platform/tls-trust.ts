import { Platform } from 'react-native';

import type { CertificateFailureReason, ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';

export type { CertificateFailureReason } from '@/shared/contracts/connection-certificate';
export type TlsProbeResult =
  | { ok: true; reason: 'ok' }
  | { ok: false; reason: CertificateFailureReason | 'network' | 'unsupported'; message?: string };

type NativeTlsModule = {
  importCertificate: (base64: string) => Promise<ConnectionCertificate>;
  setTrustAnchors: (origin: string, pems: string[]) => Promise<void>;
  clearTrustAnchors: (origin: string) => Promise<void>;
  probe: (origin: string, pem?: string) => Promise<TlsProbeResult>;
};

let nativeModule: NativeTlsModule | null | undefined;

function nativeTls() {
  if (nativeModule !== undefined) return nativeModule;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    nativeModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as typeof import('expo');
    nativeModule = requireOptionalNativeModule<NativeTlsModule>('OpencodeTls');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export function isTlsTrustSupported() {
  return nativeTls() !== null;
}

const savedTrust = new Map<string, string>();
const temporaryTrust = new Set<string>();

export function connectionOrigin(serverUrl: string) {
  const trimmed = serverUrl.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${url.hostname}:${port}`;
  } catch {
    return undefined;
  }
}

export function importCertificate(base64: string): Promise<ConnectionCertificate> {
  const module = nativeTls();
  if (!module) throw new Error('Custom certificates are not supported on this platform.');
  return module.importCertificate(base64);
}

export async function ensureConnectionTrust(settings?: OpencodeConnectionSettings) {
  const module = nativeTls();
  if (!module || !settings || settings.connect || !settings.certificate) return;
  const origin = connectionOrigin(settings.serverUrl);
  if (!origin || temporaryTrust.has(origin)) return;
  const pem = settings.certificate.pem;
  if (savedTrust.get(origin) === pem) return;
  try {
    await module.setTrustAnchors(origin, [pem]);
    savedTrust.set(origin, pem);
  } catch {
    throw new Error('Could not apply the custom CA certificate.');
  }
}

export async function withTemporaryTrust<T>(settings: OpencodeConnectionSettings | undefined, operation: () => Promise<T>): Promise<T> {
  const module = nativeTls();
  if (!module || !settings || settings.connect || !settings.certificate) return operation();
  const origin = connectionOrigin(settings.serverUrl);
  if (!origin) return operation();
  const previous = savedTrust.get(origin);
  temporaryTrust.add(origin);
  try {
    await module.setTrustAnchors(origin, [settings.certificate.pem]);
    return await operation();
  } finally {
    temporaryTrust.delete(origin);
    try {
      if (previous) await module.setTrustAnchors(origin, [previous]);
      else await module.clearTrustAnchors(origin);
    } catch {
      // The request already ran; a failed restore only leaves the draft anchor
      // until the next explicit trust update.
    }
  }
}

export async function probeConnectionTrust(settings: OpencodeConnectionSettings): Promise<TlsProbeResult> {
  const module = nativeTls();
  if (!module) return { ok: false, reason: 'unsupported' };
  const origin = connectionOrigin(settings.serverUrl);
  if (!origin) return { ok: false, reason: 'network' };
  try {
    return await module.probe(origin, settings.certificate?.pem);
  } catch (error) {
    return { ok: false, reason: 'network', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function releaseHostTrust(serverUrl: string) {
  const module = nativeTls();
  const origin = connectionOrigin(serverUrl);
  if (!origin || !module) return;
  savedTrust.delete(origin);
  temporaryTrust.delete(origin);
  await module.clearTrustAnchors(origin).catch(() => undefined);
}

export function isCertificateFailureReason(reason: TlsProbeResult['reason']): reason is CertificateFailureReason {
  return reason === 'untrusted' || reason === 'expired' || reason === 'hostname-mismatch' || reason === 'invalid';
}
