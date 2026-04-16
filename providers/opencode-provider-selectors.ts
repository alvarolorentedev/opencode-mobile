import { getHistoryPreview, toTranscriptEntry, type SessionMessageRecord, type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@/lib/opencode/client';
import type { ConversationPhase, ProviderOption } from '@/providers/opencode-provider-types';

export function getCurrentPendingPermissions(
  currentSessionId: string | undefined,
  sendingSessionId: string | undefined,
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>,
) {
  const candidateSessionIds = [...new Set([currentSessionId, sendingSessionId].filter(Boolean))] as string[];
  const matches = candidateSessionIds.flatMap((sessionId) => pendingPermissionsBySession[sessionId] || []);

  return matches.length > 0 ? matches : Object.values(pendingPermissionsBySession).flat();
}

export function getCurrentPendingQuestions(
  currentSessionId: string | undefined,
  sendingSessionId: string | undefined,
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>,
) {
  const candidateSessionIds = [...new Set([currentSessionId, sendingSessionId].filter(Boolean))] as string[];
  const matches = candidateSessionIds.flatMap((sessionId) => pendingQuestionsBySession[sessionId] || []);

  return matches.length > 0 ? matches : Object.values(pendingQuestionsBySession).flat();
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
