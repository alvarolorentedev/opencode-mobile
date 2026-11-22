import type { SessionMessageRecord } from '@/shared/presentation/format';

import { overlayLiveRecords, type LiveTranscriptBuffer } from './live-transcript';

export function overlayTranscriptSession(buffer: LiveTranscriptBuffer | undefined, sessionId: string, records: SessionMessageRecord[]) {
  const session = buffer?.messages.get(sessionId);
  let next = records;
  for (const local of buffer?.localUsers.get(sessionId) ?? []) {
    const index = next.findIndex((record) => record.info.id === local.info.id);
    if (index >= 0) {
      if (next[index].parts === local.parts) continue;
      next = next.slice();
      next[index] = local;
      continue;
    }
    const tail = next[next.length - 1];
    if (!tail || local.info.time.created >= tail.info.time.created) next = [...next, local];
  }
  return session ? overlayLiveRecords(next, [...session.values()]) : next;
}

export function overlayTranscriptMap(buffer: LiveTranscriptBuffer | undefined, partition: string | undefined, canonical: Record<string, SessionMessageRecord[]>) {
  if (!buffer || buffer.partition !== partition) return canonical;
  const sessions = new Set([...buffer.messages.keys(), ...buffer.localUsers.keys()]);
  if (!sessions.size) return canonical;
  const displayed = { ...canonical };
  for (const sessionId of sessions) displayed[sessionId] = overlayTranscriptSession(buffer, sessionId, canonical[sessionId] ?? []);
  return displayed;
}
