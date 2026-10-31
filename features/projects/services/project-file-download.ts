import { Platform } from 'react-native';

export type ProjectFileDownloadSource = {
  filename: string;
  mime: string;
  url?: string;
  headers?: Record<string, string>;
  bytes?: Uint8Array;
  signal?: AbortSignal;
};

let downloadCounter = 0;

function safeFilename(filename: string) {
  return filename.replace(/[^\w.-]/g, '_') || 'download';
}

function bytesBlob(bytes: Uint8Array, mime: string) {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  return new Blob([buffer as ArrayBuffer], { type: mime });
}

async function downloadOnWeb(source: ProjectFileDownloadSource) {
  if (!source.bytes && !source.url) throw new Error('The file could not be downloaded.');
  let blob: Blob;
  if (source.bytes) {
    blob = bytesBlob(source.bytes, source.mime);
  } else {
    const response = await fetch(source.url!, { headers: source.headers, signal: source.signal });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    blob = await response.blob();
  }
  const uri = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = uri;
  link.download = source.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(uri), 1000);
}

export async function saveOrShareProjectFile(source: ProjectFileDownloadSource) {
  if (source.signal?.aborted) throw new Error('Download canceled.');
  if (Platform.OS === 'web') {
    await downloadOnWeb(source);
    return;
  }

  const sharing = await import('expo-sharing');
  if (!await sharing.isAvailableAsync()) throw new Error('No compatible file viewer is available.');
  const { File, Paths } = await import('expo-file-system');
  const filename = safeFilename(source.filename);
  const destination = new File(Paths.cache, `download-${Date.now()}-${++downloadCounter}-${filename}`);
  try {
    if (source.url) {
      await File.downloadFileAsync(source.url, destination, {
        headers: source.headers,
        idempotent: true,
        signal: source.signal,
      });
    } else if (source.bytes) {
      if (source.signal?.aborted) throw new Error('Download canceled.');
      destination.create();
      await destination.write(source.bytes);
    } else {
      throw new Error('The file could not be downloaded.');
    }
    await sharing.shareAsync(destination.uri, { mimeType: source.mime, dialogTitle: source.filename });
  } finally {
    if (destination.exists) destination.delete();
  }
}
