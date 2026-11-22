// How a transcript refresh treats the window already held in memory.
// - initial: no usable window; download one newest page.
// - tail: the default; download one newest page and merge it in. On no overlap
//   with the held window, adopt the fetched page rather than paging backward.
// - replace: drop the held window and adopt the fetched page. Reserved for
//   server-side history rewrites (compaction and revert).
export type TranscriptRefreshMode = 'initial' | 'tail' | 'replace';

// Options for a transcript refresh. A live V2 turn is reconciled by reading its
// assistant message alone; the full page is only used for opens and recovery.
export type TranscriptReadOptions = {
  mode?: TranscriptRefreshMode;
  messageId?: string;
  inboxOnly?: boolean;
  delivered?: boolean;
  inboxID?: string;
};
