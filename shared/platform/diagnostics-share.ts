import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Sharing is always user-initiated. The cache copy is removed after the share
// sheet has had time to hand the file to the target app.
export async function shareDiagnosticReport(uri: string, fileName: string) {
  const available = await Sharing.isAvailableAsync().catch(() => false);
  if (!available) return false;
  try {
    await Sharing.shareAsync(uri, {
      dialogTitle: fileName,
      mimeType: 'application/zip',
      UTI: 'com.pkware.zip-archive',
    });
    return true;
  } finally {
    setTimeout(() => {
      try {
        new File(uri).delete();
      } catch {
        // Cache cleanup is best-effort.
      }
    }, 120_000);
  }
}
