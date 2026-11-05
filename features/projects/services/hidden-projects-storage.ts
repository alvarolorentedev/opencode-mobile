import { z } from 'zod';

import { HIDDEN_PROJECTS_MAX, type HiddenProjectsByConnection } from '@/shared/contracts/domain';

// A hidden path is only a device preference. The parser normalizes each
// connection's list the same way the retired opened-project list did: trim,
// dedupe, ignore malformed entries, and cap the result so a corrupt value can
// never hydrate an unbounded list.
const HiddenProjectsSchema = z.record(z.string(), z.unknown());

function normalizePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    if (typeof value !== 'string') continue;
    const path = value.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
    if (result.length >= HIDDEN_PROJECTS_MAX) break;
  }
  return result;
}

export function parseHiddenProjects(raw: string): HiddenProjectsByConnection {
  const value = HiddenProjectsSchema.parse(JSON.parse(raw));
  const result: HiddenProjectsByConnection = {};
  for (const [scope, paths] of Object.entries(value)) {
    const key = scope.trim();
    if (!key) continue;
    const normalized = normalizePaths(paths);
    if (normalized.length) result[key] = normalized;
  }
  return result;
}

export function serializeHiddenProjects(hidden: HiddenProjectsByConnection): string {
  const result: HiddenProjectsByConnection = {};
  for (const [scope, paths] of Object.entries(hidden)) {
    const key = scope.trim();
    if (!key) continue;
    const normalized = normalizePaths(paths);
    if (normalized.length) result[key] = normalized;
  }
  return JSON.stringify(result);
}
