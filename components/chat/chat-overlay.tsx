import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationWave } from '@/components/chat/conversation-wave';
import { Fonts, getColors } from '@/constants/theme';
import { useAppearance } from '@/providers/appearance-context';
import type { ConversationInputPhase, ConversationPhase, ConversationReadbackPhase } from '@/providers/opencode-provider-types';

const PHASE_LABEL_KEYS = {
  off: 'chat:overlay.phaseOff',
  armed: 'chat:overlay.phaseArmed',
  listening: 'chat:overlay.phaseListening',
  submitting: 'chat:overlay.phaseSubmitting',
  waiting: 'chat:overlay.phaseWaiting',
  speaking: 'chat:overlay.phaseSpeaking',
} as const;

export function ConversationOverlay({
  connectionStatus,
  feedback,
  inputPhase,
  insetsTop,
  latestUserText,
  level,
  onStop,
  phase,
  readbackPhase,
  sessionTitle,
  wakePhrase,
}: {
  connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
  feedback?: string;
  inputPhase: ConversationInputPhase;
  insetsTop: number;
  latestUserText?: string;
  level: number;
  onStop: () => void;
  phase: ConversationPhase;
  readbackPhase: ConversationReadbackPhase;
  sessionTitle: string;
  wakePhrase: string;
}) {
  const { accent } = useAppearance();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  // Conversation mode retains its dark surface with the selected accent.
  const palette = getColors('dark', accent);
  const disconnected = connectionStatus !== undefined && connectionStatus !== 'connected';
  const phaseLabel = disconnected
    ? t(connectionStatus === 'connecting' ? 'chat:connectionStatus.connecting' : connectionStatus === 'error' ? 'chat:connectionStatus.error' : 'chat:connectionStatus.offline')
    : t(PHASE_LABEL_KEYS[phase], { phrase: wakePhrase });
  const steerHint = !disconnected && inputPhase === 'armed' && readbackPhase === 'waiting';
  const showWakePhrase = phase === 'armed';
  const waveHeight = Math.min(170, Math.max(56, (height - insetsTop - insets.bottom) / (fontScale > 1.3 ? 8 : 5)));

  return (
    <View accessibilityViewIsModal testID="conversation-overlay" style={[styles.overlay, { backgroundColor: palette.background, paddingTop: insetsTop + 22, paddingBottom: Math.max(insets.bottom, 20), paddingLeft: Math.max(insets.left, 22), paddingRight: Math.max(insets.right, 22) }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="labelLarge" style={[styles.eyebrow, { color: palette.muted }]}>{t('chat:overlay.conversationMode')}</Text>
          <Text numberOfLines={2} variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{sessionTitle}</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.meta}>
            <Text accessibilityLiveRegion="polite" variant="displaySmall" style={[styles.phase, { color: disconnected ? palette.warning : palette.tint }]}>{phaseLabel}</Text>
            {!disconnected && phase === 'listening' ? (
              <Text variant="bodyLarge" style={[styles.hint, { color: palette.muted }]}>{t('chat:overlay.listeningHint')}</Text>
            ) : null}
          </View>
          <ConversationWave phase={disconnected ? 'off' : phase} level={level} tint={palette.tint} accent={palette.accent} height={waveHeight} />
          {feedback ? <Text accessibilityLiveRegion="polite" variant="bodyMedium" style={[styles.hint, { color: palette.warning }]}>{feedback}</Text> : null}
        </View>

        <View style={styles.snippet}>
          <Text variant="labelMedium" style={[styles.eyebrow, { color: palette.muted }]}>{t(showWakePhrase ? 'chat:overlay.wakePhrase' : 'chat:overlay.lastHeard')}</Text>
          <Text variant="bodyLarge" style={[styles.heard, { color: palette.text }]}>{showWakePhrase ? wakePhrase : latestUserText?.trim() || t('chat:overlay.startSpeaking')}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {steerHint ? <Text variant="bodyMedium" style={[styles.hint, { color: palette.muted }]}>{t('chat:overlay.steerHint', { phrase: wakePhrase })}</Text> : null}
        <Button testID="conversation-end" mode="contained" icon="phone-hangup" buttonColor={palette.tint} textColor={palette.background} contentStyle={styles.endContent} labelStyle={styles.endLabel} onPress={onStop}>
          {t('chat:overlay.endConversation')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 12 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { gap: 8 },
  eyebrow: { letterSpacing: 2, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.display, fontWeight: '700' },
  hero: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 32, paddingVertical: 32 },
  meta: { alignItems: 'center', gap: 12, width: '100%' },
  phase: { fontFamily: Fonts.display, fontWeight: '700', textAlign: 'center' },
  hint: { textAlign: 'center' },
  snippet: { gap: 12, paddingBottom: 32 },
  heard: { fontSize: 20, lineHeight: 29 },
  footer: { gap: 18, paddingTop: 18, width: '100%', maxWidth: 600, alignSelf: 'center' },
  endContent: { minHeight: 54 },
  endLabel: { fontWeight: '700', fontSize: 16, flexShrink: 1 },
});
