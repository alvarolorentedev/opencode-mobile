import { describe, expect, it } from 'vitest';
import { createTranscriptAccumulator } from '@/shared/platform/voice/transcript-accumulate';

describe('voice transcript accumulation', () => {
  it.each([
    ['Привет', 'мир'],
    ['你好', '世界'],
    ['مرحبا', 'بالعالم'],
    ['नमस्ते', 'दुनिया'],
    ['cafe\u0301', 'mañana １２３'],
    ['こんにちは', '안녕하세요'],
  ])('preserves Unicode segments: %s / %s', (first, second) => {
    const transcript = createTranscriptAccumulator();
    transcript.push(first, true);
    expect(transcript.push(second, true)).toBe(`${first} ${second}`);
  });

  it('revises only the current interim, including shorter final corrections', () => {
    const transcript = createTranscriptAccumulator();
    transcript.push('please', true);
    transcript.push('write the wrong words', false);
    expect(transcript.push('write the right words', false)).toBe('please write the right words');
    expect(transcript.push('write this.', true)).toBe('please write this.');
    expect(transcript.push('Next sentence.', true)).toBe('please write this. Next sentence.');
  });

  it('keeps repeated words, identical finals, punctuation and case across fresh segments', () => {
    const transcript = createTranscriptAccumulator();
    transcript.push('this is very', true);
    expect(transcript.push('very important', true)).toBe('this is very very important');
    transcript.push('Go!', true);
    expect(transcript.push('Go!', true)).toBe('this is very very important Go! Go!');
  });

  it('checkpoints an unfinished segment at every recognition boundary', () => {
    const transcript = createTranscriptAccumulator();
    transcript.push('first draft', false);
    transcript.push('first half', false);
    transcript.checkpoint();
    transcript.checkpoint();
    expect(transcript.push('second draft', false)).toBe('first half second draft');
    expect(transcript.push('second half', true)).toBe('first half second half');
    transcript.checkpoint();
    expect(transcript.push('half again', true)).toBe('first half second half half again');
  });

  it('ignores empty results and isolates new turns', () => {
    const transcript = createTranscriptAccumulator();
    transcript.push('retained', false);
    expect(transcript.push('  ', true)).toBe('retained');
    expect(transcript.push('next', false)).toBe('retained next');
    transcript.checkpoint();
    transcript.reset();
    expect(transcript.value()).toBeUndefined();
    expect(transcript.push('new turn', true)).toBe('new turn');
  });
});
