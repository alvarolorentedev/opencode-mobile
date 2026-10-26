import { z } from 'zod';

import type { ProjectPathsByConnection } from '@/providers/opencode-provider-types';

// A project is a directory the user opened on this device + connection. The
// list is ordered most-recent-first and mirrors the desktop Home list; the
// server's `project.list()` only enriches the entries (see
// providers/opencode-provider-utils.ts). The cap is enforced on hydration too,
// so a hand-edited or corrupt value can never hydrate an unbounded list.
export const PROJECTS_MAX = 50;

const ProjectPathsSchema = z.record(z.string(), z.unknown());

function normalizeEntries(paths: unknown): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    if (typeof value !== 'string') {
      continue;
    }
    const path = value.trim();
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
  const value = ProjectPathsSchema.parse(JSON.parse(raw));
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
