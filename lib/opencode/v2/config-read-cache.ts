let sequence = 0;

/**
 * V2 file reads honor `If-Modified-Since`. A file created through a temp file
 * and rename keeps the temp file's older mtime, so a cached pre-create 404 can
 * revalidate as a 304 and replay the missing-file response. A per-request query
 * parameter keeps these reads out of every HTTP cache without adding a request
 * header (which would trigger a CORS preflight on the web build).
 */
export function bustConfigReadCache(url: URL, method: string | undefined) {
  if ((method ?? 'GET').toUpperCase() !== 'GET') return undefined;
  if (!url.pathname.includes('/api/fs/read/')) return undefined;
  // Only config files can be created through the temp-file transaction. Keep
  // binary previews cacheable.
  if (!/\.jsonc?$/i.test(url.pathname)) return undefined;
  const next = new URL(url);
  next.searchParams.set('_', `${Date.now().toString(36)}-${++sequence}`);
  return next;
}
