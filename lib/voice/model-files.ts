import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

export async function sha256Hex(file: File): Promise<string> {
  const bytes = await file.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Download a pinned asset and reject size or checksum mismatches. */
export async function downloadVerified(
  url: string,
  destination: File,
  bytes: number,
  sha256: string,
  label: string,
) {
  await File.downloadFileAsync(url, destination, { idempotent: true });
  if (destination.size !== bytes) {
    if (destination.exists) {
      destination.delete();
    }
    throw new Error(`The ${label} download was incomplete.`);
  }
  if (await sha256Hex(destination) !== sha256) {
    if (destination.exists) {
      destination.delete();
    }
    throw new Error(`The ${label} download failed integrity verification.`);
  }
}
