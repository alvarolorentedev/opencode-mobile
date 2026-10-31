import type { AudioPlayer } from 'expo-audio';
import { initializeVoiceAudioAsync, stopSpeaking } from '@/shared/platform/voice/speech-output';

export { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export async function playAttachmentAudio(player: AudioPlayer) {
  await stopSpeaking();
  await initializeVoiceAudioAsync();
  if (player.duration > 0 && player.currentTime >= player.duration) await player.seekTo(0);
  player.play();
}
