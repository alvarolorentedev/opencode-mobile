// Dictation accumulation shared by the chat mic and conversation mode.
// The recognizer emits segments that reset whenever the speaker pauses:
// each finalized segment is followed by fresh-segment results (and a
// restarted session begins blank). Accumulating by splice-on-overlap keeps
// the words already heard instead of replacing them.

// Joins a recognizer segment onto the committed words, splicing out any
// overlap between the committed tail and the segment head. Android finals can
// repeat words from the previous segment (or accumulate the whole session),
// so a plain join would duplicate them. Comparison ignores case and
// punctuation because finals carry punctuation the interims lack.
export function mergeTranscriptSegment(committed: string | undefined, segment: string): string {
  if (!committed) return segment;

  const committedWords = committed.split(/\s+/);
  const segmentWords = segment.split(/\s+/);
  const normalize = (word: string) => word.toLowerCase().replace(/[^0-9a-z']/g, '');
  const maxOverlap = Math.min(committedWords.length, segmentWords.length);
  for (let count = maxOverlap; count > 0; count -= 1) {
    let matched = true;
    for (let index = 0; index < count; index += 1) {
      if (normalize(committedWords[committedWords.length - count + index]) !== normalize(segmentWords[index])) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return [...committedWords, ...segmentWords.slice(count)].join(' ');
    }
  }
  return `${committed} ${segment}`;
}

export type TranscriptAccumulator = {
  push: (transcript: string, isFinal: boolean) => string;
  reset: () => void;
  value: () => string | undefined;
};

// Holds the words heard so far. Finals commit their text; interim results
// revise only the in-flight tail, so recognizer corrections cannot duplicate
// or erase finalized words.
export function createTranscriptAccumulator(): TranscriptAccumulator {
  let committed: string | undefined;
  let current: string | undefined;
  return {
    push(transcript: string, isFinal: boolean) {
      const segment = transcript.trim();
      if (!segment) {
        return current ?? '';
      }

      current = mergeTranscriptSegment(committed, segment);
      if (isFinal) {
        committed = current;
      }
      return current;
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
