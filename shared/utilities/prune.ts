// Small provider-agnostic helpers that do not belong to a specific domain
// (project labels, project list derivation, and grouping pending interactions
// by session).

// Drop per-session entries whose session is no longer kept once the map exceeds
// `limit`. Returns the same reference when there is nothing to prune, so
// consumers can skip a re-render.
export function pruneByKeepIds<T>(current: Record<string, T>, keepIds: Set<string>, limit: number): Record<string, T> {
  const keys = Object.keys(current);
  if (keys.length <= limit) {
    return current;
  }
  const next: Record<string, T> = {};
  for (const key of keys) {
    if (keepIds.has(key)) next[key] = current[key];
  }
  return next;
}
