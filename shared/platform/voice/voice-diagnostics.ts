import { telemetry } from '@/shared/observability/client';

export type VoiceSource = 'dictation' | 'conversation' | 'enrollment';
export type VoiceCancellation = 'user' | 'background' | 'screen-exit';
export type VoiceDiagnosticPhase = 'preflight' | 'recognition' | 'teardown' | 'model' | 'permission' | 'audio-session' | 'stream' | 'sample' | 'embedding' | 'save';

const nativeReasons = new Set([
  'aborted', 'audio-capture', 'busy', 'client', 'interrupted', 'language-not-supported',
  'network', 'no-speech', 'not-allowed', 'service-not-allowed', 'speech-timeout', 'too-many-requests',
]);

export function recognitionErrorReason(code: string) {
  return nativeReasons.has(code) ? code : 'unknown';
}

const audioCaptureCodes = [
  'ERR_AUDIO_PERMISSIONS', 'ERR_AUDIO_STREAM_INITIALIZATION', 'ERR_AUDIO_STREAM_UNSUPPORTED_CONFIG', 'ERR_AUDIO_STREAM',
] as const;

export function audioCaptureErrorCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return audioCaptureCodes.find((known) => known === code);
}

type VoiceDiagnostic = {
  source: VoiceSource;
  phase: VoiceDiagnosticPhase;
  reason: string;
  attempt?: number;
  kind?: 'default' | 'on-device' | 'compatibility' | 'google';
  statusCode?: number | typeof audioCaptureCodes[number];
  durationMs?: number;
};

export function recordVoiceDiagnostic(outcome: 'retry' | 'cancelled' | 'blocked' | 'failed', details: VoiceDiagnostic) {
  const operation = details.source === 'enrollment' ? 'voice.enrollment' : 'voice.recognition';
  const attrs = { ...details, operation, outcome };
  if (outcome === 'failed') {
    telemetry.captureError({
      name: 'VoiceCaptureError',
      message: details.source === 'enrollment' ? 'Voice enrollment failed' : 'System voice capture failed',
    }, attrs, false);
  } else {
    telemetry.info(`voice.${outcome}`, attrs);
  }
}

type WakeOutcome = 'ready' | 'restart-gap' | 'silence' | 'speech-without-transcript' | 'transcript'
  | 'phrase-not-matched' | 'detected' | 'no-microphone-frames' | 'decode-failed'
  | 'speaker-rejected' | 'command-start-failed' | 'command-capture-failed' | 'command-not-heard';

export function recordWakeDiagnostic(kind: 'system' | 'local', outcome: WakeOutcome, durationMs?: number) {
  const attrs = { operation: 'voice.wake', kind, outcome, durationMs };
  if (outcome === 'no-microphone-frames' || outcome === 'command-start-failed' || outcome === 'command-capture-failed') {
    telemetry.info('voice.wake', attrs);
  } else {
    telemetry.debug('voice.wake', attrs);
  }
}
