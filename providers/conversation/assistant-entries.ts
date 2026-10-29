import { toTranscriptEntry, type SessionMessageRecord } from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { ConversationReadbackEntry } from '@/providers/opencode-provider-types';

export function getConversationAssistantEntries(
  messagesBySession: Record<string, SessionMessageRecord[]>,
  sessionId?: string,
): ConversationReadbackEntry[] {
  if (!sessionId) {
    return [];
  }

  return (messagesBySession[sessionId] || []).flatMap((record) => {
    const entry = toTranscriptEntry(record);
    if (entry.role !== 'assistant' || !isTranscriptDisplayMessage(entry) || !entry.text.trim()) {
      return [];
    }
    return [{
      completed: record.info?.time?.completed !== undefined
        || (record.info?.role === 'assistant' && Boolean(record.info.finish)),
      entry,
    }];
  });
}
