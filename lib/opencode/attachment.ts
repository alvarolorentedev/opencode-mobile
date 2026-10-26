import type { PromptAttachment } from './prompt-inbox';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const COMPRESS_ABOVE_BYTES = 1 * 1024 * 1024;

export type PreparedAttachment = { type: 'file'; mime: string; filename?: string; url: string };

function isRemote(uri: string) {
  return /^(?:https?:\/\/|data:)/i.test(uri);
}

// Mobile-local URIs are not reachable from the OpenCode server, so they are
// encoded as data URLs. Large camera images are downscaled/re-encoded before
// that step: a 10 MB JPEG becomes ~13 MB of JSON on the wire, which is a poor
// fit for a 3G/4G uplink and a common source of stalled prompt submissions.
export async function prepareAttachment(att: PromptAttachment): Promise<PreparedAttachment> {
  const filename = att.filename || att.uri.split('/').pop();
  const mime = att.mime || 'application/octet-stream';
  if (isRemote(att.uri)) {
    return { type: 'file', mime, filename, url: att.uri };
  }

  const { File } = await import('expo-file-system');
  const source = new File(att.uri);
  const size = source.exists ? source.size : 0;
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error('File exceeds the 10 MB attachment limit.');
  }

  if (mime.startsWith('image/') && !/gif|svg/i.test(mime) && size > COMPRESS_ABOVE_BYTES) {
    try {
      const manipulator = await import('expo-image-manipulator');
      const result = await manipulator.manipulateAsync(
        att.uri,
        [{ resize: { width: 2048 } }],
        { compress: 0.8, format: manipulator.SaveFormat.JPEG, base64: true },
      );
      if (result.base64) {
        return {
          type: 'file',
          mime: 'image/jpeg',
          filename: filename?.replace(/\.[^.]+$/, '') ? `${filename.replace(/\.[^.]+$/, '')}.jpg` : 'attachment.jpg',
          url: `data:image/jpeg;base64,${result.base64}`,
        };
      }
    } catch {
      // Compression is best-effort; the original bytes remain valid.
    }
  }

  const base64 = await source.base64();
  return { type: 'file', mime, filename, url: `data:${mime};base64,${base64}` };
}
