import { parseStoredConnectionCertificate, type ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import { createEncryptedStore } from '@/shared/storage/encrypted-store';

const CERTIFICATE_KEY_STORAGE_KEY = 'opencode-mobile.connection-certificate-key';
const CONNECTION_CERTIFICATE_STORAGE_KEY = 'opencode-mobile.connection-certificate';
const certificates = createEncryptedStore(CERTIFICATE_KEY_STORAGE_KEY);

function profileCertificateKey(profileId: string) {
  return `opencode-mobile.connection-profile-certificate.${profileId}`;
}

function certificateAad(id: string) {
  return `opencode-mobile:connection-certificate:${id}`;
}

async function readCertificate(id: string, storageKey: string) {
  const ciphertext = await certificates.readCiphertext(storageKey).catch(() => '');
  if (!ciphertext) return undefined;

  // A transient Keychain/Keystore failure is not a missing key: generating a
  // replacement here would orphan this ciphertext.
  const encryptionKey = await certificates.key().catch(() => undefined);
  if (!encryptionKey) return undefined;

  try {
    const plaintext = await certificates.decrypt(encryptionKey, certificateAad(id), ciphertext);
    const certificate = parseStoredConnectionCertificate(JSON.parse(plaintext));
    if (!certificate) throw new Error('invalid stored certificate');
    return certificate;
  } catch {
    // The key was available and the payload still failed: fail closed.
    await certificates.writeCiphertext(storageKey, '').catch(() => undefined);
    return undefined;
  }
}

async function saveCertificate(id: string, storageKey: string, certificate: ConnectionCertificate | undefined) {
  if (!certificate) {
    await certificates.writeCiphertext(storageKey, '');
    return;
  }
  const encryptionKey = await certificates.key();
  const ciphertext = await certificates.encrypt(encryptionKey, certificateAad(id), JSON.stringify(certificate));
  try {
    await certificates.writeCiphertext(storageKey, ciphertext);
  } catch (error) {
    await certificates.writeCiphertext(storageKey, '').catch(() => undefined);
    throw error;
  }
}

export function getConnectionCertificate() {
  return readCertificate('active', CONNECTION_CERTIFICATE_STORAGE_KEY);
}

export function saveConnectionCertificate(certificate: ConnectionCertificate | undefined) {
  return saveCertificate('active', CONNECTION_CERTIFICATE_STORAGE_KEY, certificate);
}

export function getProfileCertificate(profileId: string) {
  return readCertificate(profileId, profileCertificateKey(profileId));
}

export function saveProfileCertificate(profileId: string, certificate: ConnectionCertificate | undefined) {
  return saveCertificate(profileId, profileCertificateKey(profileId), certificate);
}

export function deleteProfileCertificate(profileId: string) {
  return certificates.writeCiphertext(profileCertificateKey(profileId), '');
}
