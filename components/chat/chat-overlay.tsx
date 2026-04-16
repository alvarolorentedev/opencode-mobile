import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ConversationOverlay({
  currentActivityLabel,
  insetsTop,
  latestAssistantText,
  latestUserText,
  level,
  onStop,
  phase,
  sessionTitle,
  statusLabel,
}: {
  currentActivityLabel?: string;
  insetsTop: number;
  latestAssistantText?: string;
  latestUserText?: string;
  level: number;
  onStop: () => void;
  phase: 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';
  sessionTitle: string;
  statusLabel?: string;
}) {
  useKeepAwake('opencode-conversation-overlay');

  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const breathe = useRef(new Animated.Value(0)).current;
  const levelScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    const cappedLevel = Math.min(12, Math.max(0, level));
    const phaseBoost = phase === 'speaking' ? 0.08 : phase === 'listening' ? 0.04 : 0.02;
    Animated.spring(levelScale, {
      toValue: 1 + Math.min(0.22, cappedLevel * 0.015 + phaseBoost),
      friction: 7,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [level, levelScale, phase]);

  const breatheScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const shellOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 0.96],
  });

  const accent = colorScheme === 'dark' ? '#4EE0B6' : '#39C5B0';
  const electric = '#2C8CFF';
  const overlayBackground = colorScheme === 'dark' ? '#060A09' : '#091110';
  const overlaySurface = colorScheme === 'dark' ? 'rgba(20, 32, 29, 0.86)' : 'rgba(235, 246, 242, 0.12)';
  const overlayText = '#F4FBF8';
  const overlayMuted = 'rgba(228, 240, 236, 0.7)';
  const snippetLabel = phase === 'speaking' ? 'Latest reply' : phase === 'submitting' ? 'Sending' : 'Heard';
  const snippetText = phase === 'speaking' ? latestAssistantText : latestUserText || latestAssistantText;
  const phaseCopy =
    phase === 'listening'
      ? 'Listening for your next turn.'
      : phase === 'submitting'
        ? 'Sending what you just said.'
        : phase === 'speaking'
          ? 'Reading the latest reply aloud.'
          : currentActivityLabel
            ? `OpenCode is ${currentActivityLabel.toLowerCase()}.`
            : 'OpenCode is thinking through the next step.';

  return (
    <View style={[styles.voiceOverlay, { backgroundColor: overlayBackground, paddingTop: insetsTop + 14 }]}> 
      <View style={[styles.voiceOverlayGlow, styles.voiceOverlayGlowTop, { backgroundColor: `${accent}22` }]} />
      <View style={[styles.voiceOverlayGlow, styles.voiceOverlayGlowBottom, { backgroundColor: `${electric}22` }]} />

      <View style={styles.voiceOverlayContent}>
        <View style={styles.voiceOverlayHeader}>
          <View style={styles.voiceOverlayHeaderCopy}>
            <Text variant="labelLarge" style={[styles.voiceOverlayEyebrow, { color: overlayMuted }]}>Conversation mode</Text>
            <Text numberOfLines={1} variant="headlineSmall" style={[styles.voiceOverlayTitle, { color: overlayText }]}>
              {sessionTitle}
            </Text>
          </View>
          <View style={[styles.voiceOverlayStatusPill, { backgroundColor: overlaySurface, borderColor: `${palette.border}66` }]}>
            <MaterialCommunityIcons name={phase === 'speaking' ? 'volume-high' : 'microphone'} size={16} color={overlayText} />
            <Text variant="labelMedium" style={{ color: overlayText }}>{statusLabel || 'Active'}</Text>
          </View>
        </View>

        <View style={styles.voiceOverlayCenter}>
          <Animated.View style={[styles.voiceOrbShell, { opacity: shellOpacity, transform: [{ scale: breatheScale }] }]}>
            <Animated.View style={[styles.voiceOrbCore, { transform: [{ scale: levelScale }] }]}>
              <View style={[styles.voiceOrbAura, { backgroundColor: `${accent}40` }]} />
              <View style={[styles.voiceOrbBlobTop, { backgroundColor: '#DFF8F6' }]} />
              <View style={[styles.voiceOrbBlobBottom, { backgroundColor: electric }]} />
              <View style={[styles.voiceOrbHighlight, { backgroundColor: 'rgba(255,255,255,0.48)' }]} />
            </Animated.View>
          </Animated.View>

          <View style={styles.voiceOverlayMeta}>
            <Text variant="headlineSmall" style={[styles.voiceOverlayPhaseTitle, { color: overlayText }]}>
              {statusLabel || 'Conversation active'}
            </Text>
            <Text variant="bodyLarge" style={[styles.voiceOverlayPhaseCopy, { color: overlayMuted }]}> 
              {phaseCopy}
            </Text>
          </View>
        </View>

        <View style={styles.voiceOverlayFooter}>
          <View style={[styles.voiceOverlaySnippetCard, { backgroundColor: overlaySurface, borderColor: 'rgba(255,255,255,0.08)' }]}>
            <Text variant="labelMedium" style={{ color: overlayMuted }}>{snippetLabel}</Text>
            <Text numberOfLines={3} variant="bodyLarge" style={{ color: overlayText }}>
              {snippetText?.trim() || 'Start speaking naturally. OpenCode will listen, answer, and keep the loop going.'}
            </Text>
          </View>

          <Button
            mode="contained"
            icon="phone-hangup"
            buttonColor="#F2F5F3"
            textColor="#111917"
            contentStyle={styles.voiceOverlayDoneContent}
            labelStyle={styles.voiceOverlayDoneLabel}
            onPress={onStop}>
            Done
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  voiceOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 12 },
  voiceOverlayGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.85,
  },
  voiceOverlayGlowTop: { top: -30, right: -50 },
  voiceOverlayGlowBottom: { bottom: 140, left: -70 },
  voiceOverlayContent: { flex: 1, paddingHorizontal: 22, paddingBottom: 22 },
  voiceOverlayHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  voiceOverlayHeaderCopy: { flex: 1, minWidth: 0, gap: 6 },
  voiceOverlayEyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  voiceOverlayTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  voiceOverlayStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  voiceOverlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  voiceOrbShell: {
    width: 252,
    height: 252,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  voiceOrbCore: {
    width: 212,
    height: 212,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DDF7F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOrbAura: {
    position: 'absolute',
    width: 176,
    height: 176,
    borderRadius: 999,
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
  voiceOverlayMeta: { alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  voiceOverlayPhaseTitle: { fontFamily: Fonts.display, fontWeight: '700', textAlign: 'center' },
  voiceOverlayPhaseCopy: { textAlign: 'center', lineHeight: 28, maxWidth: 320 },
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
