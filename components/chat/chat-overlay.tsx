import { withAlpha } from '@/lib/color';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { Fonts, getColors } from '@/constants/theme';
import { useAppearance } from '@/providers/appearance-context';
import type { ConversationPhase } from '@/providers/opencode-provider';

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
  insetsTop,
  latestUserText,
  onStop,
  phase,
  sessionTitle,
  wakePhrase,
}: {
  connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
  insetsTop: number;
  latestUserText?: string;
  onStop: () => void;
  phase: ConversationPhase;
  sessionTitle: string;
  wakePhrase: string;
}) {
  const { accent: accentColor } = useAppearance();
  const { t } = useTranslation();
  const [orbScale] = useState(() => new Animated.Value(1));
  const [orbOpacity] = useState(() => new Animated.Value(0.9));

  useEffect(() => {
    const targetScale = phase === 'speaking' ? 1.03 : phase === 'listening' ? 1.015 : 1;
    const targetOpacity = phase === 'speaking' ? 1 : phase === 'listening' ? 0.96 : 0.9;

    Animated.parallel([
      Animated.timing(orbScale, {
        toValue: targetScale,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(orbOpacity, {
        toValue: targetOpacity,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [orbOpacity, orbScale, phase]);

  // The overlay is always dark, so use the selected theme's dark palette
  // regardless of the active scheme.
  const palette = getColors('dark', accentColor);
  const overlayBackground = palette.background;
  const overlaySurface = palette.surface;
  const overlayText = palette.text;
  const overlayMuted = palette.muted;
  const orbRing = phase === 'speaking' ? withAlpha(palette.accent, 0x55 / 255) : withAlpha(palette.tint, 0x30 / 255);
  const phaseLabel = t(PHASE_LABEL_KEYS[phase], { phrase: wakePhrase });
  const connectionEmoji = connectionStatus === 'error' ? '⚠️' : connectionStatus === 'connecting' ? '🔄' : undefined;

  return (
    <View style={[styles.voiceOverlay, { backgroundColor: overlayBackground, paddingTop: insetsTop + 14 }]}> 
      <View style={styles.voiceOverlayContent}>
        <View style={styles.voiceOverlayHeader}>
          <View style={styles.voiceOverlayHeaderCopy}>
            <Text variant="labelLarge" style={[styles.voiceOverlayEyebrow, { color: overlayMuted }]}>{t('chat:overlay.conversationMode')}</Text>
            <Text numberOfLines={1} variant="headlineMedium" style={[styles.voiceOverlayTitle, { color: overlayText }]}> 
              {sessionTitle}
            </Text>
          </View>
          {connectionEmoji ? <Text style={styles.voiceOverlayConnectionEmoji}>{connectionEmoji}</Text> : null}
        </View>

        <View style={styles.voiceOverlayCenter}>
          <Animated.View style={[styles.voiceOrbShell, { borderColor: orbRing, opacity: orbOpacity, transform: [{ scale: orbScale }] }]}> 
            <View style={[styles.voiceOrbCore, { backgroundColor: palette.surfaceAlt }]}>
              <View style={[styles.voiceOrbBlobTop, { backgroundColor: palette.tint }]} />
              <View style={[styles.voiceOrbBlobBottom, { backgroundColor: palette.accent }]} />
              <View style={[styles.voiceOrbHighlight, { backgroundColor: 'rgba(255,255,255,0.36)' }]} />
            </View>
          </Animated.View>

          <View style={styles.voiceOverlayMeta}>
            <Text variant="headlineSmall" style={[styles.voiceOverlayPhaseTitle, { color: overlayText }]}> 
              {phaseLabel}
            </Text>
          </View>
        </View>

        <View style={styles.voiceOverlayFooter}>
          <View style={[styles.voiceOverlaySnippetCard, { backgroundColor: overlaySurface, borderColor: palette.border }]}>
            <Text variant="labelMedium" style={{ color: overlayMuted }}>
              {phase === 'armed' ? t('chat:overlay.wakePhrase') : t('chat:overlay.lastHeard')}
            </Text>
            <Text numberOfLines={3} variant="bodyLarge" style={{ color: overlayText }}>
              {phase === 'armed'
                ? wakePhrase
                : latestUserText?.trim() || t('chat:overlay.startSpeaking')}
            </Text>
          </View>
          <Button
            mode="contained"
            icon="phone-hangup"
            buttonColor={palette.tint}
            textColor={palette.background}
            contentStyle={styles.voiceOverlayDoneContent}
            labelStyle={styles.voiceOverlayDoneLabel}
            onPress={onStop}>
            {t('common:actions.done')}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  voiceOverlay: { ...StyleSheet.absoluteFill, zIndex: 12 },
  voiceOverlayContent: { flex: 1, paddingHorizontal: 22, paddingBottom: 22 },
  voiceOverlayHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingHorizontal: 4 },
  voiceOverlayHeaderCopy: { flex: 1, minWidth: 0, gap: 4 },
  voiceOverlayConnectionEmoji: { fontSize: 26, lineHeight: 30 },
  voiceOverlayEyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  voiceOverlayTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  voiceOverlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  voiceOrbShell: {
    width: 252,
    height: 252,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  voiceOrbCore: {
    width: 212,
    height: 212,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOrbBlobTop: {
    position: 'absolute',
    top: 18,
    width: 126,
    height: 126,
    borderRadius: 999,
    opacity: 0.95,
  },
  voiceOrbBlobBottom: {
    position: 'absolute',
    bottom: 8,
    width: 188,
    height: 122,
    borderRadius: 999,
    opacity: 0.88,
  },
  voiceOrbHighlight: {
    position: 'absolute',
    top: 30,
    left: 36,
    width: 42,
    height: 42,
    borderRadius: 999,
  },
  voiceOverlayMeta: { alignItems: 'center', gap: 12, paddingHorizontal: 14, maxWidth: 320 },
  voiceOverlayPhaseTitle: { fontFamily: Fonts.display, fontWeight: '700', textAlign: 'center' },
  voiceOverlayFooter: { gap: 18 },
  voiceOverlaySnippetCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  voiceOverlayDoneContent: { minHeight: 52 },
  voiceOverlayDoneLabel: { fontWeight: '700', fontSize: 16 },
});
