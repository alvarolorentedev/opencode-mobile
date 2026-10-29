// Microphone helpers for the local wake-word path. All of this is pure so the
// frame conversion, resampling and ring-buffer behavior can be unit tested
// without a native build.

export function int16ToFloat32(data: ArrayBuffer, channels = 1): Float32Array {
  const samples = new Int16Array(data);
  const channelCount = Math.max(1, Math.floor(channels));
  if (channelCount === 1) {
    const output = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index++) {
      output[index] = samples[index] / 32768;
    }
    return output;
  }

  const frames = Math.floor(samples.length / channelCount);
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    const offset = frame * channelCount;
    for (let channel = 0; channel < channelCount; channel++) {
      sum += samples[offset + channel];
    }
    output[frame] = sum / channelCount / 32768;
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

const RESAMPLER_TAPS = 95;

function lowPassCoefficients(cutoff: number, taps: number) {
  const coefficients = new Float32Array(taps);
  const midpoint = (taps - 1) / 2;
  let sum = 0;
  for (let index = 0; index < taps; index++) {
    const offset = index - midpoint;
    const sinc = offset === 0
      ? 2 * cutoff
      : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
    // Blackman window keeps the stop band well behaved without a long filter.
    const window = 0.42
      - 0.5 * Math.cos((2 * Math.PI * index) / (taps - 1))
      + 0.08 * Math.cos((4 * Math.PI * index) / (taps - 1));
    coefficients[index] = sinc * window;
    sum += coefficients[index];
  }
  if (sum !== 0) {
    for (let index = 0; index < taps; index++) {
      coefficients[index] /= sum;
    }
  }
  return coefficients;
}

function createLowPass(fromRate: number, toRate: number) {
  // Keep the pass band below the output Nyquist frequency. A little margin is
  // left for the filter transition so high-frequency noise cannot alias back
  // into the speech band when a device delivers 44.1/48 kHz instead of 16 kHz.
  const cutoff = 0.45 * Math.min(1, toRate / fromRate);
  const coefficients = lowPassCoefficients(cutoff, RESAMPLER_TAPS);
  const history = new Float32Array(RESAMPLER_TAPS - 1);

  const updateHistory = (samples: Float32Array) => {
    if (samples.length >= history.length) {
      history.set(samples.subarray(samples.length - history.length));
      return;
    }
    history.copyWithin(0, samples.length);
    history.set(samples, history.length - samples.length);
  };

  return {
    push(samples: Float32Array) {
      const output = new Float32Array(samples.length);
      for (let index = 0; index < samples.length; index++) {
        let value = 0;
        for (let tap = 0; tap < coefficients.length; tap++) {
          const source = tap <= index
            ? samples[index - tap]
            : history[history.length + index - tap];
          value += coefficients[tap] * source;
        }
        output[index] = value;
      }
      if (samples.length > 0) {
        updateHistory(samples);
      }
      return output;
    },
    reset() {
      history.fill(0);
    },
  };
}

/**
 * Streaming anti-aliased resampler. A short FIR low-pass runs at the input rate
 * before fractional interpolation, so 48 kHz device fallback does not fold
 * high-frequency noise into the 16 kHz wake/command band.
 */
export function createResampler(fromRate: number, toRate: number) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    return {
      push: (samples: Float32Array) => samples,
      reset: () => undefined,
    };
  }
  if (fromRate === toRate) {
    return {
      push: (samples: Float32Array) => samples,
      reset: () => undefined,
    };
  }

  const ratio = fromRate / toRate;
  const lowPass = createLowPass(fromRate, toRate);
  let position = 0;

  return {
    push(samples: Float32Array): Float32Array {
      if (samples.length === 0) {
        return samples;
      }
      const filtered = lowPass.push(samples);
      const output: number[] = [];
      while (position < filtered.length) {
        const lower = Math.floor(position);
        const fraction = position - lower;
        const left = filtered[lower];
        const rightIndex = lower + 1;
        const right = rightIndex < filtered.length ? filtered[rightIndex] : left;
        output.push(left + (right - left) * fraction);
        position += ratio;
      }
      position -= filtered.length;
      return Float32Array.from(output);
    },
    reset() {
      position = 0;
      lowPass.reset();
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

/**
 * Keep the most recent speech-like region of a buffer for a speaker embedding.
 * The wake phrase cannot be verified reliably when the sample is mostly room
 * noise or pre-speech silence, so walk back from the last active frame and stop
 * after a short pause.
 */
export function selectSpeechSegment(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds = 2,
  minimumRms = 0.006,
) {
  if (samples.length === 0 || !(sampleRate > 0)) {
    return samples;
  }
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  const frameCount = Math.ceil(samples.length / frameSize);
  const maxSamples = Math.min(samples.length, Math.max(1, Math.round(maxSeconds * sampleRate)));
  let lastActive = -1;

  const frameRms = (frame: number) => {
    const start = frame * frameSize;
    return rmsLevel(samples.subarray(start, Math.min(samples.length, start + frameSize)));
  };

  for (let frame = frameCount - 1; frame >= 0; frame--) {
    if (frameRms(frame) >= minimumRms) {
      lastActive = Math.min(samples.length, (frame + 1) * frameSize);
      break;
    }
  }
  if (lastActive < 0) {
    return samples.subarray(Math.max(0, samples.length - maxSamples));
  }

  let start = Math.max(0, lastActive - maxSamples);
  let silenceFrames = 0;
  for (let frame = Math.floor(lastActive / frameSize) - 1; frame >= 0; frame--) {
    if (frameRms(frame) < minimumRms) {
      silenceFrames += 1;
      if (silenceFrames * frameSize >= Math.round(sampleRate * 0.4)) {
        // The silent run is [frame, frame + silenceFrames); speech starts
        // immediately after it, so keep one extra frame of margin.
        start = Math.max(start, Math.min(lastActive, (frame + silenceFrames) * frameSize));
        break;
      }
    } else {
      silenceFrames = 0;
    }
  }
  return samples.subarray(start, lastActive);
}
