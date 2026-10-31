import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { downloadFileWithRetry, ModelDownloadError } from '@/shared/platform/models/model-download';

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
  await downloadFileWithRetry(url, destination, label, async (file) => {
    if (file.size !== bytes) {
      throw new ModelDownloadError(
        'incomplete',
        `The ${label} download was incomplete.`,
        true,
      );
    }
    if (await sha256Hex(file) !== sha256) {
      throw new ModelDownloadError(
        'integrity',
        `The ${label} download failed integrity verification.`,
        false,
      );
    }
  });
}
