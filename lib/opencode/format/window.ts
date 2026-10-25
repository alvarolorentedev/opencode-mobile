import type { SessionMessageRecord } from './types';

// Record equality covers BOTH parts and info. toTranscriptEntry reads
// record.info.error (via getMessageError) — if the server adds an error
// post-hoc without changing parts, ignoring info would silently drop the
// error banner AND poison the WeakMap cache. JSON.stringify is cheap here:
// info is small metadata (id/role/time/error) and the network/parse cost of
// the fetch has already been paid.
function sessionMessageRecordsEqual(prior: SessionMessageRecord, record: SessionMessageRecord) {
  return (
    prior === record ||
    (prior.parts.length === record.parts.length &&
      JSON.stringify(prior.parts) === JSON.stringify(record.parts) &&
      JSON.stringify(prior.info) === JSON.stringify(record.info))
  );
}

// A page is a contiguous slice of durable server order. When a response arrives
// after a newer window has already been applied it can still contain records
// the newer window no longer holds (for example the prompt that started the
// turn). Place unseen records next to the page anchor they follow instead of
// blindly appending them, otherwise an older prompt can land below newer
// assistant replies. `applyUpdates` is false for stale pages so they can fill
// gaps without rolling a streamed assistant record back to an earlier snapshot.
type MergeSessionMessageWindowOptions = {
  applyUpdates?: boolean;
  adoptUnknownWindow?: boolean;
};

function mergeKnownRecordUpdates(previous: SessionMessageRecord[], fetched: SessionMessageRecord[]) {
  const previousIndexById = new Map<string, number>();
  for (let index = 0; index < previous.length; index += 1) {
    previousIndexById.set(previous[index].info.id, index);
  }

  let merged: SessionMessageRecord[] | undefined;
  for (const record of fetched) {
    const index = previousIndexById.get(record.info.id);
    if (index === undefined) continue;
    const prior = (merged ?? previous)[index];
    if (!sessionMessageRecordsEqual(prior, record)) {
      if (!merged) merged = previous.slice();
      merged[index] = record;
    }
  }

  return merged ?? previous;
}

// Merge a freshly fetched page into the window already held in memory. Known
// records are replaced in place when their content changed; unseen records are
// inserted at their page-relative position. Record object references are
// preserved for unchanged messages so toTranscriptEntry's WeakMap cache keeps
// skipping the tokenization pass. The array reference is preserved when nothing
// changed, letting downstream useMemos skip.
export function mergeSessionMessageWindow(
  previous: SessionMessageRecord[],
  fetched: SessionMessageRecord[],
  options: MergeSessionMessageWindowOptions = {},
): SessionMessageRecord[] {
  if (previous.length === 0) {
    return fetched;
  }
  if (fetched.length === 0) {
    return previous;
  }

  const { applyUpdates = true, adoptUnknownWindow = true } = options;
  const previousIndexById = new Map<string, number>();
  for (let index = 0; index < previous.length; index += 1) {
    previousIndexById.set(previous[index].info.id, index);
  }

  if (!fetched.some((record) => previousIndexById.has(record.info.id))) {
    // A burst larger than one page landed, or a stale page arrived late.
    // Callers disable adoption for stale pages so they cannot replace a newer
    // window with an older one.
    return adoptUnknownWindow ? fetched : previous;
  }

  let merged = previous.slice();
  let inserted = 0;
  let lastAnchorIndex = -1;
  let changed = false;
  let pending: SessionMessageRecord[] = [];
  const pendingIds = new Set<string>();

  const flushPending = (beforeAnchorIndex?: number) => {
    if (pending.length === 0) return;
    // Unseen records before the first anchor belong in front of it. Records
    // after an anchor belong immediately after that anchor: if the page is
    // stale, newer held records may follow and must stay below it.
    const insertAt = lastAnchorIndex < 0
      ? (beforeAnchorIndex ?? 0) + inserted
      : lastAnchorIndex + inserted + 1;
    merged.splice(insertAt, 0, ...pending);
    inserted += pending.length;
    pending = [];
    pendingIds.clear();
    changed = true;
  };

  for (const record of fetched) {
    const previousIndex = previousIndexById.get(record.info.id);
    if (previousIndex === undefined) {
      if (!pendingIds.has(record.info.id)) {
        pendingIds.add(record.info.id);
        pending.push(record);
      }
      continue;
    }

    if (previousIndex < lastAnchorIndex) {
      // The page is not a contiguous slice of the held window. Keep held order
      // and only apply updates that can be placed unambiguously.
      return applyUpdates ? mergeKnownRecordUpdates(previous, fetched) : previous;
    }

    flushPending(previousIndex);
    lastAnchorIndex = previousIndex;
    if (!applyUpdates) continue;

    const currentIndex = previousIndex + inserted;
    const prior = merged[currentIndex];
    if (!sessionMessageRecordsEqual(prior, record)) {
      merged[currentIndex] = record;
      changed = true;
    }
  }

  flushPending();
  return changed ? merged : previous;
}

// Prepend an *older* page fetched while scrolling up. Records already present
// are dropped (pages can overlap at the cursor), so the result stays a single
// deduped contiguous window with `previous` order preserved.
export function prependSessionMessageHistory(previous: SessionMessageRecord[], older: SessionMessageRecord[]): SessionMessageRecord[] {
  if (older.length === 0) {
    return previous;
  }

  const known = new Set(previous.map((record) => record.info.id));
  const additions = older.filter((record) => !known.has(record.info.id));
  if (additions.length === 0) {
    return previous;
  }

  return [...additions, ...previous];
}
