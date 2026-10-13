import { MAX_ATTACHMENT_BYTES, validateAttachmentUri } from '@/lib/attachment-preview';
import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';

// Cap the amount of shared text staged into the composer. Attachments keep the
// existing per-file 10 MB limit; this only bounds the text block.
export const MAX_SHARE_TEXT = 100_000;
export const MAX_SHARE_ITEMS = 10;

export type IncomingShareItem = {
  value?: string;
  shareType?: 'text' | 'url' | 'audio' | 'image' | 'video' | 'file';
  mimeType?: string;
  contentUri?: string | null;
  contentType?: 'text' | 'audio' | 'image' | 'video' | 'file' | 'website' | null;
  contentMimeType?: string | null;
  contentSize?: number | null;
  originalName?: string | null;
};

export type SharedPayload = {
  text?: string;
  url?: string;
  attachments: PromptAttachment[];
  // Display names of items that were dropped (oversize or unreadable), so the
  // preview can explain what was ignored instead of silently losing it.
  skipped: string[];
};

function displayName(item: IncomingShareItem): string {
  const name = item.originalName?.trim();
  if (name) return name;
  const uri = item.contentUri?.trim();
  if (uri) return uri.split('/').pop() || uri;
  return item.value?.slice(0, 40).trim() || 'shared item';
}

/**
 * Normalize raw OS share payloads into the composer's own attachment shape.
 * Pure and platform-free so it is testable without the native module. Returns
 * null when nothing usable was shared. Oversize or non-allowlisted items are
 * dropped into `skipped`; nothing here sends or persists content.
 */
export function parseIncomingShare(items: IncomingShareItem[]): SharedPayload | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const texts: string[] = [];
  const urls: string[] = [];
  const attachments: PromptAttachment[] = [];
  const skipped: string[] = [];

  for (const item of items.slice(0, MAX_SHARE_ITEMS)) {
    // Java File.toURI() emits file:/…; keep percent-encoded paths intact.
    const contentUri = item.contentUri?.trim().replace(/^file:\/(?!\/)/i, 'file:///') || undefined;
    const kind = item.contentType ?? undefined;
    const isFileLike = Boolean(contentUri);

    if (!isFileLike) {
      const value = (item.value ?? '').trim();
      if (!value) continue;
      if (item.shareType === 'url' || kind === 'website') urls.push(value);
      else texts.push(value);
      continue;
    }

    if (kind === 'website' && /^https?:\/\//i.test(contentUri!)) {
      urls.push(contentUri!);
      continue;
    }

    try {
      validateAttachmentUri(contentUri!);
    } catch {
      skipped.push(displayName(item));
      continue;
    }

    if (typeof item.contentSize === 'number' && item.contentSize > MAX_ATTACHMENT_BYTES) {
      skipped.push(displayName(item));
      continue;
    }

    attachments.push({
      uri: contentUri!,
      mime: item.contentMimeType || item.mimeType || undefined,
      filename: item.originalName?.trim() || contentUri!.split('/').pop(),
    });
  }

  const text = texts.join('\n\n').slice(0, MAX_SHARE_TEXT).trim();
  const url = urls[0];
  if (!text && !url && attachments.length === 0 && skipped.length === 0) {
    return null;
  }

  return {
    ...(text ? { text } : {}),
    ...(url ? { url } : {}),
    attachments,
    skipped,
  };
}

export function mergeSharedDraft(draft: string, attachments: PromptAttachment[], payload: SharedPayload) {
  const text = [payload.text, payload.url].filter(Boolean).join('\n\n');
  const seen = new Set(attachments.map((item) => item.uri));
  const additions = payload.attachments.filter((item) => {
    if (seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
  return {
    draft: text ? (draft.trim() ? `${draft}\n\n${text}` : text) : draft,
    attachments: additions.length ? [...attachments, ...additions] : attachments,
  };
}
