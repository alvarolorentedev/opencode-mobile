import type { SpeechPlayback } from '@/lib/voice/speech-types';

export type SpeechPlaybackPreferences = {
  ttsEngine?: 'system' | 'local';
  localTtsPackId?: string;
  localTtsSpeakerId?: number;
  speechVoiceId?: string;
};

/**
 * Resolve the user's playback choice without touching native state. Unknown or
 * incomplete local selections fall back to the system engine; the speaker
 * itself falls back again if the pack has gone missing.
 */
export function getSpeechPlayback(preferences: SpeechPlaybackPreferences): SpeechPlayback {
  if (preferences.ttsEngine === 'local' && preferences.localTtsPackId) {
    return {
      engine: 'local',
      packId: preferences.localTtsPackId,
      speakerId: Math.max(0, Math.trunc(preferences.localTtsSpeakerId ?? 0)),
    };
  }
  return { engine: 'system', voice: preferences.speechVoiceId };
}
