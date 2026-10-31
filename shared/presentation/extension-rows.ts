

/**
 * Shared rows are read-only entries from other scopes. System-managed rows are
 * hidden because they cannot be changed from the app and only add noise.
 */
export function visibleSharedRows<T extends { source: string }>(rows: T[]) {
  return rows.filter((row) => row.source !== 'system');
}
