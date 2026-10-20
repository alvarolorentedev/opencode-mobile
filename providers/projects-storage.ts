import type { ProjectPathsByConnection } from '@/providers/opencode-provider-types';

// A project is a directory the user opened on this device + connection. The
// list is ordered most-recent-first and mirrors the desktop Home list; the
// server's `project.list()` only enriches the entries (see
// providers/opencode-provider-utils.ts). The cap is enforced on hydration too,
// so a hand-edited or corrupt value can never hydrate an unbounded list.
export const PROJECTS_MAX = 50;

function toProjectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const path = value.trim();
  return path.length > 0 ? path : undefined;
}

function normalizeEntries(paths: unknown): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    const path = toProjectPath(value);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
    if (result.length >= PROJECTS_MAX) {
      break;
    }
  }
  return result;
}

export function parseProjectPathsByConnection(raw: string): ProjectPathsByConnection {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected opened projects keyed by connection.');
  }
  const result: ProjectPathsByConnection = {};
  for (const [scope, paths] of Object.entries(value)) {
    if (!scope.trim()) {
      continue;
    }
    // An explicit empty list means the user closed every project on this
    // connection; only a missing scope seeds from the server again.
    result[scope] = normalizeEntries(paths);
  }
  return result;
}

export function serializeProjectPathsByConnection(projects: ProjectPathsByConnection): string {
  const result: ProjectPathsByConnection = {};
  for (const [scope, paths] of Object.entries(projects)) {
    if (!scope.trim()) {
      continue;
    }
    result[scope] = normalizeEntries(paths);
  }
  return JSON.stringify(result);
}
