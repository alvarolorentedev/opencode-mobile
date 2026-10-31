import { useSyncExternalStore } from 'react';

// Lightweight, privacy-safe request diagnostics. This is deliberately a ring
// buffer instead of a logger: it answers "is the app slow or retrying?" from
// Settings without storing URLs, bodies, or credentials.
export type RequestStats = {
  total: number;
  failed: number;
  timeouts: number;
  retries: number;
  p50Ms: number;
  p95Ms: number;
  lastStatus?: number;
  lastDurationMs?: number;
};

const WINDOW = 40;
const durations: number[] = [];
let total = 0;
let failed = 0;
let timeouts = 0;
let retries = 0;
let lastStatus: number | undefined;
let lastDurationMs: number | undefined;
let snapshot: RequestStats;
const listeners = new Set<() => void>();

function emit() {
  snapshot = readRequestStats();
  for (const listener of listeners) listener();
}

function percentile(fraction: number) {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function readRequestStats(): RequestStats {
  return {
    total,
    failed,
    timeouts,
    retries,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    ...(lastStatus === undefined ? {} : { lastStatus }),
    ...(lastDurationMs === undefined ? {} : { lastDurationMs }),
  };
}

snapshot = readRequestStats();

export function getRequestStats(): RequestStats {
  return snapshot;
}

export function recordRequestStart() {
  const startedAt = Date.now();
  return (result: { status?: number; error?: unknown; retried?: boolean } = {}) => {
    const duration = Math.max(0, Date.now() - startedAt);
    total += 1;
    lastDurationMs = duration;
    if (result.status !== undefined) lastStatus = result.status;
    if (result.error !== undefined) {
      failed += 1;
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      if (/timed out|timeout/i.test(message)) timeouts += 1;
    }
    if (result.retried) retries += 1;
    durations.push(duration);
    if (durations.length > WINDOW) durations.shift();
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRequestStats(): RequestStats {
  return useSyncExternalStore(subscribe, getRequestStats, getRequestStats);
}
