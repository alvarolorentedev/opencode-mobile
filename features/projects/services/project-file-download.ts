import { Platform } from 'react-native';
import { fetchConnection } from '@/shared/protocol/opencode/client/fetch';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client/types';

export type ProjectFileDownloadSource = {
  filename: string;
  mime: string;
  url?: string;
  headers?: Record<string, string>;
  oidcConnection?: OpencodeConnectionSettings;
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

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

async function downloadResponse(source: ProjectFileDownloadSource, url: string) {
  const { headers, signal, oidcConnection } = source;
  const response = oidcConnection
    ? await fetchConnection(url, { headers, signal, redirect: 'error' }, oidcConnection, undefined, DOWNLOAD_TIMEOUT_MS)
    : await fetch(url, { headers, signal });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Download failed (${response.status}).`);
  }
  return response;
}

async function downloadOnWeb(source: ProjectFileDownloadSource) {
  if (!source.bytes && !source.url) throw new Error('The file could not be downloaded.');
  let blob: Blob;
  if (source.bytes) {
    blob = bytesBlob(source.bytes, source.mime);
  } else {
    const response = await downloadResponse(source, source.url!);
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
    if (source.url && source.oidcConnection) {
      destination.create();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      source.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await downloadResponse({ ...source, signal: controller.signal }, source.url);
        await response.body?.pipeTo(destination.writableStream(), { signal: controller.signal });
      } finally {
        cancel();
        source.signal?.removeEventListener('abort', cancel);
      }
    } else if (source.url) {
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
    if (source.signal?.aborted) throw new Error('Download canceled.');
    await sharing.shareAsync(destination.uri, { mimeType: source.mime, dialogTitle: source.filename });
  } finally {
    if (destination.exists) destination.delete();
  }
}
