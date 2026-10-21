// Finals and recognition-session boundaries commit a segment. Only the active
// interim may be corrected; matching words alone never prove replayed audio.
export function createTranscriptAccumulator() {
  let committed: string | undefined;
  let current: string | undefined;
  return {
    push(transcript: string, isFinal: boolean) {
      const segment = transcript.trim();
      if (!segment) {
        if (isFinal) committed = current;
        return current ?? '';
      }

      current = committed ? `${committed} ${segment}` : segment;
      if (isFinal) committed = current;
      return current;
    },
    checkpoint() {
      committed = current;
    },
    reset() {
      committed = undefined;
      current = undefined;
    },
    value() {
      return current;
    },
  };
}
