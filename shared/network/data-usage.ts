import { useSyncExternalStore } from 'react';

import { DATA_USAGE_STORAGE_KEY } from '@/shared/storage/keys';

// Lightweight network usage counter for diagnosing data-heavy sessions
// (issue #68). Every app request funnels through fetchConnection in client.ts,
// so counting there captures V1, V2, and Cloud Link traffic. Streaming responses
// are counted by requests only; their byte stream is not buffered just to
// measure it. Totals are persisted per calendar day so a relaunch does not hide
// the day's usage.
export type DataUsage = {
  requests: number;
  bytes: number;
};

function dayKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

let day = dayKey();
let usage: DataUsage = { requests: 0, bytes: 0 };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrated = false;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function rolloverIfNeeded() {
  const today = dayKey();
  if (today !== day) {
    day = today;
    usage = { requests: 0, bytes: 0 };
  }
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void persist();
  }, 1000);
}

async function persist() {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(DATA_USAGE_STORAGE_KEY, JSON.stringify({ day, ...usage }));
  } catch {
    // Persistence is best-effort; the in-memory counter still drives the UI.
  }
}

async function hydrate() {
  if (hydrated) {
    return;
  }
  hydrated = true;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(DATA_USAGE_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const record = JSON.parse(raw) as { day?: unknown; requests?: unknown; bytes?: unknown };
    if (record.day !== day) {
      await AsyncStorage.setItem(DATA_USAGE_STORAGE_KEY, JSON.stringify({ day, requests: 0, bytes: 0 }));
      return;
    }
    if (typeof record.requests === 'number' && typeof record.bytes === 'number') {
      usage = { requests: record.requests, bytes: record.bytes };
      emit();
    }
  } catch {
    // A malformed or unreadable record falls back to a fresh counter.
  }
}

void hydrate();

export function recordRequest() {
  rolloverIfNeeded();
  usage = { ...usage, requests: usage.requests + 1 };
  emit();
  scheduleSave();
}

export function recordBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return;
  }
  rolloverIfNeeded();
  usage = { ...usage, bytes: usage.bytes + bytes };
  emit();
  scheduleSave();
}

export function getDataUsage(): DataUsage {
  return usage;
}

export function resetDataUsage() {
  day = dayKey();
  usage = { requests: 0, bytes: 0 };
  emit();
  void persist();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDataUsage(): DataUsage {
  return useSyncExternalStore(subscribe, getDataUsage, getDataUsage);
}

export function formatDataUsage(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
