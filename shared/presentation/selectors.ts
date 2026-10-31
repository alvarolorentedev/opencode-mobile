import { toTranscriptEntry, type SessionMessageRecord, type TranscriptEntry } from '@/shared/presentation/format';

import { getTranscriptActivityLabel, hasMessageBubble } from '@/shared/presentation/transcript';

export function getTranscriptActivityLabelForEntries(transcript: TranscriptEntry[]) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (hasMessageBubble(entry)) {
      continue;
    }

    const label = getTranscriptActivityLabel(entry);
    if (label) {
      return label;
    }
  }

  return undefined;
}

export function getTranscript(messages: SessionMessageRecord[]) {
  return messages.map(toTranscriptEntry);
}
