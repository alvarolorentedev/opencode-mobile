import { act } from 'react';
import { vi } from 'vitest';
import { controlledClock } from './controlled-clock';

const native = vi.hoisted(() => ({
  stream: { start: vi.fn(), stop: vi.fn() },
  buffer: undefined as ((buffer: { data: ArrayBuffer; sampleRate: number; channels: number; timestamp: number }) => void) | undefined,
  permission: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  accept: vi.fn(),
  recognize: vi.fn(),
  embedding: vi.fn(),
  ensure: vi.fn(),
  profile: vi.fn(),
  save: vi.fn(),
  captureError: vi.fn(),
  info: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active' } }));
vi.mock('expo-audio', () => ({
  useAudioStream: ({ onBuffer }: { onBuffer: typeof native.buffer }) => {
    native.buffer = onBuffer;
    return { stream: native.stream, isStreaming: true };
  },
}));
vi.mock('@/shared/platform/voice/permissions', () => ({ ensureLocalVoicePermissionAsync: native.permission }));
vi.mock('@/shared/platform/voice/local-wake-word/audio-session', () => ({
  activateLocalWakeRecordingAsync: native.activate,
  deactivateLocalWakeRecordingAsync: native.deactivate,
}));
vi.mock('@/shared/platform/voice/local-wake-word/runtime', () => ({
  acceptWakeWordSamples: native.accept,
  acceptVadSamples: native.accept,
  computeLocalSpeakerEmbedding: native.embedding,
  ensureLocalSpeakerRuntime: native.ensure,
  ensureLocalVoiceRuntime: native.ensure,
  ensureLocalCommandRuntime: async () => {},
  recognizeLocalCommand: native.recognize,
  resetVad: async () => {},
  resetWakeWordStream: async () => {},
}));
vi.mock('@/shared/platform/voice/local-wake-word/models', () => ({ getLocalVoiceModelStatus: () => 'ready' }));
vi.mock('@/shared/platform/voice/local-wake-word/speaker-profile', () => ({
  loadLocalSpeakerProfile: native.profile,
  saveLocalSpeakerProfile: native.save,
}));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('@/shared/observability/client', () => ({
  telemetry: { debug() {}, warn() {}, captureError: native.captureError, info: native.info },
}));

export function audioFixture() {
  vi.resetAllMocks();
  const clock = controlledClock();
  native.stream.start.mockResolvedValue(undefined);
  native.activate.mockResolvedValue(undefined);
  native.deactivate.mockResolvedValue(undefined);
  native.permission.mockResolvedValue({ granted: true });
  native.ensure.mockResolvedValue(undefined);
  native.profile.mockResolvedValue(undefined);
  const feed = (value = 1000, length = 160) => {
    const data = new Int16Array(length).fill(value);
    act(() => native.buffer?.({ data: data.buffer, sampleRate: 16000, channels: 1, timestamp: 0 }));
  };
  return { clock, feed, native };
}
