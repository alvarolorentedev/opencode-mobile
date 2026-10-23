import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Button, Text } from 'react-native-paper';

import { playAttachmentAudio, useAudioPlayer, useAudioPlayerStatus } from '@/lib/voice/attachment-audio';

export function AudioPreview({ uri, onError }: { uri: string; onError: () => void }) {
  const { t } = useTranslation();
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') player.pause(); });
    return () => subscription.remove();
  }, [player]);
  useEffect(() => { if (status.playbackState === 'error') onError(); }, [onError, status.playbackState]);
  return (
    <View style={styles.audio}>
      <Text>{`${Math.floor(status.currentTime)} / ${Math.floor(status.duration)} s`}</Text>
      <Button testID="attachment-audio-play" icon={status.playing ? 'pause' : 'play'} mode="contained" disabled={!status.isLoaded}
        onPress={() => { if (status.playing) player.pause(); else void playAttachmentAudio(player).catch(onError); }}>
        {t(status.playing ? 'chat:attachments.pause' : 'chat:attachments.play')}
      </Button>
    </View>
  );
}

export function VideoPreview({ uri, onError }: { uri: string; onError: () => void }) {
  const player = useVideoPlayer(uri);
  useEffect(() => {
    const status = player.addListener('statusChange', ({ status }) => { if (status === 'error') onError(); });
    const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') player.pause(); });
    return () => { status.remove(); appState.remove(); player.pause(); };
  }, [onError, player]);
  return <VideoView testID="attachment-video-preview" player={player} nativeControls contentFit="contain" playsInline style={styles.video} />;
}

const styles = StyleSheet.create({
  audio: { alignItems: 'center', gap: 16, paddingVertical: 24 },
  video: { flex: 1, width: '100%', minHeight: 0 },
});
