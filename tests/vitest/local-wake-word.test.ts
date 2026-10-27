import { describe, expect, it } from 'vitest';

import {
  LOCAL_COMMAND_MODELS,
  LOCAL_VOICE_ASR_TARBALL_BYTES,
  LOCAL_VOICE_KWS_TARBALL_BYTES,
  LOCAL_VOICE_SPEAKER_MODEL_BYTES,
  LOCAL_VOICE_VAD_MODEL_BYTES,
  localCommandModelDownloadSizeLabel,
  localVoiceBaseDownloadSizeLabel,
  localVoiceDownloadSizeLabel,
  localVoiceKeywords,
} from '@/lib/voice/local-wake-word/model-constants';
import {
  createAudioRingBuffer,
  createResampler,
  float32ToInt16,
  int16ToFloat32,
  rmsLevel,
} from '@/lib/voice/local-wake-word/pcm';
import {
  averageEmbeddings,
  cosineSimilarity,
  normalizeEmbedding,
} from '@/lib/voice/local-wake-word/similarity';
import {
  LOCAL_WAKE_PHRASES,
  normalizeLocalCommandModel,
  normalizeLocalWakePhrase,
} from '@/lib/voice/local-wake-word/types';

describe('local wake phrase configuration', () => {
  it('ships pretrained keyword tokens instead of requiring model training', () => {
    expect(localVoiceKeywords('hey-code')).toBe('▁HE Y ▁CO DE\n');
    expect(localVoiceKeywords('hey-opencode')).toBe('▁HE Y ▁O P EN CO DE\n');
    expect(Object.keys(LOCAL_WAKE_PHRASES)).toEqual(['hey-code', 'hey-opencode']);
  });

  it('normalizes unknown phrase ids', () => {
    expect(normalizeLocalWakePhrase('hey-opencode')).toBe('hey-opencode');
    expect(normalizeLocalWakePhrase('hey-code')).toBe('hey-code');
    expect(normalizeLocalWakePhrase('anything-else')).toBe('hey-code');
    expect(normalizeLocalWakePhrase(undefined)).toBe('hey-code');
  });

  it('keeps model download sizes explicit', () => {
    expect(LOCAL_VOICE_KWS_TARBALL_BYTES).toBeGreaterThan(10_000_000);
    expect(LOCAL_VOICE_SPEAKER_MODEL_BYTES).toBeGreaterThan(20_000_000);
    expect(LOCAL_VOICE_VAD_MODEL_BYTES).toBeLessThan(1_000_000);
    expect(LOCAL_VOICE_ASR_TARBALL_BYTES).toBeGreaterThan(100_000_000);
  });

  it('offers an English and a multilingual command model using pretrained files', () => {
    expect(Object.keys(LOCAL_COMMAND_MODELS)).toEqual(['moonshine-tiny-en', 'whisper-tiny-multi']);
    expect(LOCAL_COMMAND_MODELS['moonshine-tiny-en'].files.decoder).toBeUndefined();
    expect(LOCAL_COMMAND_MODELS['whisper-tiny-multi'].files.encoder).toBe('tiny-encoder.int8.onnx');
    expect(LOCAL_COMMAND_MODELS['whisper-tiny-multi'].files.decoder).toBe('tiny-decoder.int8.onnx');
    expect(normalizeLocalCommandModel('whisper-tiny-multi')).toBe('whisper-tiny-multi');
    expect(normalizeLocalCommandModel('unknown')).toBe('moonshine-tiny-en');
    expect(localVoiceBaseDownloadSizeLabel()).toMatch(/^~4\d MB$/);
    expect(localCommandModelDownloadSizeLabel('moonshine-tiny-en')).toMatch(/^~10\d MB$/);
    expect(localCommandModelDownloadSizeLabel('whisper-tiny-multi')).toMatch(/^~11\d MB$/);
    expect(localVoiceDownloadSizeLabel('moonshine-tiny-en')).toMatch(/^~15\d MB$/);
    expect(localVoiceDownloadSizeLabel('whisper-tiny-multi')).toMatch(/^~16\d MB$/);
  });
});

describe('local voice PCM helpers', () => {
  it('converts signed 16-bit PCM without clipping', () => {
    const samples = new Int16Array([0, 32767, -32768, 16384]);
    const floats = int16ToFloat32(samples.buffer);
    expect(floats[0]).toBe(0);
    expect(floats[1]).toBeCloseTo(1, 4);
    expect(floats[2]).toBeCloseTo(-1, 4);
    expect(floats[3]).toBeCloseTo(0.5, 4);
    const roundTrip = float32ToInt16(floats);
    expect(Array.from(roundTrip)).toEqual([0, 32766, -32768, 16384]);
  });

  it('resamples 48 kHz to 16 kHz and preserves a continuous stream', () => {
    const resampler = createResampler(48000, 16000);
    const input = new Float32Array(4800);
    for (let index = 0; index < input.length; index++) {
      input[index] = Math.sin((index / 48000) * Math.PI * 2 * 440);
    }
    const output = resampler.push(input);
    expect(output.length).toBeGreaterThan(1500);
    expect(output.length).toBeLessThan(1700);
    expect(output.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('keeps only the configured tail of the audio ring buffer', () => {
    const ring = createAudioRingBuffer(10);
    ring.push(new Float32Array([1, 2, 3, 4, 5, 6]));
    ring.push(new Float32Array([7, 8, 9, 10, 11, 12]));
    expect(Array.from(ring.tail(4))).toEqual([9, 10, 11, 12]);
    expect(ring.size()).toBe(10);
    ring.push(new Float32Array(20).fill(7));
    expect(ring.size()).toBe(10);
    expect(Array.from(ring.tail(2))).toEqual([7, 7]);
  });

  it('computes a bounded RMS level', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rmsLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 4);
  });
});

describe('local speaker similarity', () => {
  it('compares and normalizes embeddings', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(normalizeEmbedding([3, 4])).toEqual([0.6, 0.8]);
    expect(normalizeEmbedding([0, 0])).toEqual([0, 0]);
    const average = averageEmbeddings([[1, 0], [0, 1]]);
    expect(average?.[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(average?.[1]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(averageEmbeddings([])).toBeUndefined();
  });
});
