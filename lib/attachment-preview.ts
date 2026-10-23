import { decode } from 'base-64';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';

import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function pickedAttachment(asset: { uri: string; base64?: string; mimeType?: string; name: string }): PromptAttachment {
  const mime = asset.mimeType || 'application/octet-stream';
  const uri = asset.base64 ? asset.base64.startsWith('data:') ? asset.base64 : `data:${mime};base64,${asset.base64}` : asset.uri;
  if (Platform.OS === 'web' && asset.base64 && asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
  return { uri, mime, filename: asset.name };
}

export function attachmentKind(attachment: PromptAttachment) {
  const mime = attachment.mime || attachment.uri.match(/^data:([^;,]+)/i)?.[1] || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(attachment.filename || '')) return 'video';
  if (mime.startsWith('text/') || /^(application\/(json|xml|javascript))$/.test(mime)
    || /\.(txt|md|csv|json|xml|log|js|ts|tsx|py|yaml|yml)$/i.test(attachment.filename || '')) return 'text';
  return 'document';
}

export function dataUrlBytes(uri: string) {
  const match = uri.match(/^data:([^,]*),([\s\S]*)$/i);
  if (!match) throw new Error('Invalid attachment data.');
  const encoded = assertDataUrlSize(match[1], match[2]);
  const body: string | undefined = /;base64$/i.test(match[1]) ? decode(encoded) : undefined;
  const bytes = body !== undefined
    ? Uint8Array.from(body, (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(encoded));
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
  return bytes;
}

function assertSize(bytes: number) {
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
}

function assertDataUrlSize(header: string, encoded: string) {
  if (/;base64$/i.test(header)) {
    const compact = encoded.replace(/\s/g, '');
    assertSize(Math.floor(compact.length * 3 / 4) - (compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0));
    return compact;
  }
  let bytes = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '%') { index += 2; bytes++; }
    else {
      const point = encoded.codePointAt(index)!;
      bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      if (point > 65535) index++;
    }
    assertSize(bytes);
  }
  return encoded;
}

async function readRemoteBytes(uri: string, signal?: AbortSignal) {
  const response = await (Platform.OS === 'web' ? fetch : expoFetch)(uri, { signal });
  if (!response.ok) throw new Error('Could not read attachment.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Attachment streaming is unavailable.');
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    assertSize(Number(response.headers.get('content-length')) || 0);
    while (true) {
      if (signal?.aborted) throw new Error('Attachment read canceled.');
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      assertSize(total);
      chunks.push(value);
    }
    if (signal?.aborted) throw new Error('Attachment read canceled.');
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { signal?.removeEventListener('abort', abort); abort(); reader.releaseLock(); }
}

export function validateAttachmentUri(uri: string) {
  if (!/^(data:|https?:\/\/|file:\/\/|content:\/\/|blob:)/i.test(uri)) {
    throw new Error('Attachment content is unavailable.');
  }
  if (/^data:/i.test(uri)) {
    const comma = uri.indexOf(',');
    if (comma < 0) throw new Error('Invalid attachment data.');
    assertDataUrlSize(uri.slice(0, comma), uri.slice(comma + 1));
  }
}

export async function readAttachmentText(attachment: PromptAttachment, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Attachment read canceled.');
  validateAttachmentUri(attachment.uri);
  if (attachment.uri.startsWith('data:')) return new TextDecoder().decode(dataUrlBytes(attachment.uri));
  if (Platform.OS !== 'web' && /^(file|content):/i.test(attachment.uri)) {
    const { File } = await import('expo-file-system');
    const file = new File(attachment.uri);
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
    return file.text();
  }
  const bytes = await readRemoteBytes(attachment.uri, signal);
  return new TextDecoder().decode(bytes);
}

let previewCounter = 0;
// Project files are read from the OpenCode API as bytes, so they bypass the
// chat attachment 10 MB limit. Callers decide whether a preview is appropriate.
export async function prepareAttachmentBytes(bytes: Uint8Array, mime: string, filename: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Attachment read canceled.');
  if (Platform.OS === 'web') {
    const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
    const uri = URL.createObjectURL(new Blob([buffer as ArrayBuffer], { type: mime }));
    return { uri, release: () => URL.revokeObjectURL(uri) };
  }
  const { File, Paths } = await import('expo-file-system');
  const name = filename.replace(/[^\w.-]/g, '_') || 'file';
  const file = new File(Paths.cache, `preview-${Date.now()}-${++previewCounter}-${name}`);
  try {
    if (signal?.aborted) throw new Error('Attachment read canceled.');
    file.create();
    file.write(bytes);
    return { uri: file.uri, release: () => { if (file.exists) file.delete(); } };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

export async function prepareAttachmentFile(attachment: PromptAttachment, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Attachment read canceled.');
  validateAttachmentUri(attachment.uri);
  if (Platform.OS === 'web') {
    if (/^(https?:|blob:)/i.test(attachment.uri)) {
      const bytes = await readRemoteBytes(attachment.uri, signal);
      const uri = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: attachment.mime || 'application/octet-stream' }));
      return { uri, release: () => URL.revokeObjectURL(uri) };
    }
    return { uri: attachment.uri, release: () => {} };
  }
  const { File, Paths } = await import('expo-file-system');
  if (/^(file|content):/i.test(attachment.uri)) {
    assertSize(new File(attachment.uri).size);
    return { uri: attachment.uri, release: () => {} };
  }
  const name = (attachment.filename || 'attachment').replace(/[^\w.-]/g, '_');
  const file = new File(Paths.cache, `preview-${Date.now()}-${++previewCounter}-${name}`);
  try {
    const bytes = attachment.uri.startsWith('data:') ? dataUrlBytes(attachment.uri) : await readRemoteBytes(attachment.uri, signal);
    if (signal?.aborted) throw new Error('Attachment read canceled.');
    file.create();
    file.write(bytes);
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
    return { uri: file.uri, release: () => { if (file.exists) file.delete(); } };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

export async function openAttachmentExternally(attachment: PromptAttachment, signal?: AbortSignal) {
  validateAttachmentUri(attachment.uri);
  if (Platform.OS === 'web') {
    if (/^https?:/i.test(attachment.uri)) {
      window.open(attachment.uri, '_blank', 'noopener,noreferrer');
      return;
    }
    let uri = attachment.uri;
    if (uri.startsWith('data:')) {
      const bytes = dataUrlBytes(uri);
      uri = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: attachment.mime || 'application/octet-stream' }));
    }
    const link = document.createElement('a');
    link.href = uri;
    link.download = attachment.filename || 'attachment';
    link.click();
    if (uri !== attachment.uri) setTimeout(() => URL.revokeObjectURL(uri), 1000);
    return;
  }
  const sharing = await import('expo-sharing');
  if (!await sharing.isAvailableAsync()) throw new Error('No compatible document viewer is available.');
  const file = await prepareAttachmentFile(attachment, signal);
  try {
    await sharing.shareAsync(file.uri, { mimeType: attachment.mime, dialogTitle: attachment.filename });
  } finally {
    file.release();
  }
}
