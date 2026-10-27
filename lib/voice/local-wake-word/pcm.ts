// Microphone helpers for the local wake-word path. All of this is pure so the
// frame conversion, resampling and ring-buffer behavior can be unit tested
// without a native build.

export function int16ToFloat32(data: ArrayBuffer): Float32Array {
  const samples = new Int16Array(data);
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    output[index] = samples[index] / 32768;
  }
  return output;
}

export function float32ToInt16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    output[index] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return output;
}

/**
 * Streaming linear resampler. Carries the fractional phase and the last input
 * sample between buffers so frame boundaries do not introduce clicks.
 */
export function createResampler(fromRate: number, toRate: number) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    return {
      push: (samples: Float32Array) => samples,
    };
  }
  if (fromRate === toRate) {
    return {
      push: (samples: Float32Array) => samples,
    };
  }

  const ratio = fromRate / toRate;
  let position = 0;
  let previous = 0;
  let hasPrevious = false;

  return {
    push(samples: Float32Array): Float32Array {
      if (samples.length === 0) {
        return samples;
      }
      const output: number[] = [];
      // `position` is relative to the current buffer. The previous sample is
      // treated as index -1 so interpolation across the boundary is continuous.
      while (position < samples.length) {
        const lower = Math.floor(position);
        const fraction = position - lower;
        const left = lower < 0 ? previous : samples[lower];
        const rightIndex = lower + 1;
        const right = rightIndex < samples.length ? samples[rightIndex] : left;
        output.push(left + (right - left) * fraction);
        position += ratio;
      }
      position -= samples.length;
      previous = samples[samples.length - 1];
      hasPrevious = true;
      // `hasPrevious` is intentionally kept for clarity; the loop above uses
      // previous only when lower is negative, which happens after a carry.
      void hasPrevious;
      return Float32Array.from(output);
    },
    reset() {
      position = 0;
      previous = 0;
      hasPrevious = false;
    },
  };
}

export function createAudioRingBuffer(maxSamples: number) {
  const capacity = Math.max(1, Math.floor(maxSamples));
  let buffer = new Float32Array(capacity);
  let length = 0;
  let writeIndex = 0;

  return {
    clear() {
      buffer = new Float32Array(capacity);
      length = 0;
      writeIndex = 0;
    },
    push(samples: Float32Array) {
      if (samples.length === 0) {
        return;
      }
      // Drop old samples when the new chunk alone is larger than the buffer.
      const source = samples.length > capacity ? samples.subarray(samples.length - capacity) : samples;
      for (let index = 0; index < source.length; index++) {
        buffer[writeIndex] = source[index];
        writeIndex = (writeIndex + 1) % capacity;
        if (length < capacity) {
          length += 1;
        }
      }
    },
    tail(maxTailSamples: number): Float32Array {
      const count = Math.min(length, Math.max(0, Math.floor(maxTailSamples)));
      if (count === 0) {
        return new Float32Array(0);
      }
      const output = new Float32Array(count);
      let cursor = (writeIndex - count + capacity) % capacity;
      for (let index = 0; index < count; index++) {
        output[index] = buffer[cursor];
        cursor = (cursor + 1) % capacity;
      }
      return output;
    },
    size() {
      return length;
    },
  };
}

export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index++) {
    sum += samples[index] * samples[index];
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}
