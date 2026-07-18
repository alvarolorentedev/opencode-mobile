import { getHistoryPreview, toTranscriptEntry, type SessionMessageRecord, type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { ConversationPhase, ProviderOption } from '@/providers/opencode-provider-types';

export function getCurrentPendingRequests<T>(
  currentSessionId: string | undefined,
  sendingSessionId: string | undefined,
  pendingRequestsBySession: Record<string, T[]>,
) {
  const candidateSessionIds = [...new Set([currentSessionId, sendingSessionId].filter(Boolean))] as string[];
  const matches = candidateSessionIds.flatMap((sessionId) => pendingRequestsBySession[sessionId] || []);

  return matches;
}

export function getConfiguredProviders(availableProviders: ProviderOption[]) {
  return availableProviders.filter((provider) => provider.configured);
}

export function getTranscriptActivityLabelForEntries(transcript: TranscriptEntry[]) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (isTranscriptDisplayMessage(entry)) {
      continue;
    }

    const label = getTranscriptActivityLabel(entry);
    if (label) {
      return label;
    }
  }

  return undefined;
}

export function getConversationStatusLabel(conversationPhase: ConversationPhase, conversationCurrentActivityLabel?: string) {
  switch (conversationPhase) {
    case 'listening':
      return 'Listening';
    case 'submitting':
      return 'Sending';
    case 'waiting':
      return conversationCurrentActivityLabel || 'Thinking';
    case 'speaking':
      return 'Speaking';
    default:
      return undefined;
  }
}

export function getSessionPreviewById(messagesBySession: Record<string, SessionMessageRecord[]>) {
  return Object.fromEntries(Object.entries(messagesBySession).map(([sessionId, messages]) => [sessionId, getHistoryPreview(messages)]));
}

export function getTranscript(messages: SessionMessageRecord[]) {
  return messages.map(toTranscriptEntry);
}
