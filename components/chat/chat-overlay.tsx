import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  onStop,
  phase,
  sessionTitle,
  statusLabel,
}: {
  currentActivityLabel?: string;
  insetsTop: number;
  latestAssistantText?: string;
  latestUserText?: string;
  onStop: () => void;
  phase: 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';
  sessionTitle: string;
  statusLabel?: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const orbScale = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.9)).current;
  const statusOpacity = useRef(new Animated.Value(0.82)).current;

  useEffect(() => {
    const targetScale = phase === 'speaking' ? 1.03 : phase === 'listening' ? 1.015 : 1;
    const targetOpacity = phase === 'speaking' ? 1 : phase === 'listening' ? 0.96 : 0.9;
    const targetStatusOpacity = phase === 'waiting' ? 0.74 : 0.88;

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
      Animated.timing(statusOpacity, {
        toValue: targetStatusOpacity,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [orbOpacity, orbScale, phase, statusOpacity]);

  const accent = colorScheme === 'dark' ? '#4EE0B6' : '#6FDCCA';
  const electric = '#2C8CFF';
  const overlayBackground = colorScheme === 'dark' ? '#020404' : '#040808';
  const overlaySurface = colorScheme === 'dark' ? 'rgba(16, 22, 21, 0.92)' : 'rgba(18, 27, 26, 0.88)';
  const overlayText = '#F4FBF8';
  const overlayMuted = 'rgba(228, 240, 236, 0.68)';
  const orbRing = phase === 'speaking' ? `${electric}30` : `${accent}24`;
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
      <View style={styles.voiceOverlayContent}>
        <View style={styles.voiceOverlayHeader}>
          <View style={styles.voiceOverlayHeaderCopy}>
            <Text variant="labelLarge" style={[styles.voiceOverlayEyebrow, { color: overlayMuted }]}>Conversation mode</Text>
            <Text numberOfLines={1} variant="headlineSmall" style={[styles.voiceOverlayTitle, { color: overlayText }]}>
              {sessionTitle}
            </Text>
          </View>
          <Animated.View style={{ opacity: statusOpacity }}>
            <View style={[styles.voiceOverlayStatusPill, { backgroundColor: overlaySurface, borderColor: `${palette.border}52` }]}> 
              <MaterialCommunityIcons name={phase === 'speaking' ? 'volume-high' : 'microphone'} size={16} color={overlayText} />
              <Text variant="labelMedium" style={{ color: overlayText }}>{statusLabel || 'Active'}</Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.voiceOverlayCenter}>
          <Animated.View style={[styles.voiceOrbShell, { borderColor: orbRing, opacity: orbOpacity, transform: [{ scale: orbScale }] }]}> 
            <View style={styles.voiceOrbCore}>
              <View style={[styles.voiceOrbBlobTop, { backgroundColor: '#D7F3F0' }]} />
              <View style={[styles.voiceOrbBlobBottom, { backgroundColor: electric }]} />
              <View style={[styles.voiceOrbHighlight, { backgroundColor: 'rgba(255,255,255,0.36)' }]} />
            </View>
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
          <View style={[styles.voiceOverlaySnippetCard, { backgroundColor: overlaySurface, borderColor: 'rgba(255,255,255,0.06)' }]}> 
            <Text variant="labelMedium" style={{ color: overlayMuted }}>{snippetLabel}</Text>
            <Text numberOfLines={3} variant="bodyLarge" style={{ color: overlayText }}>
              {snippetText?.trim() || 'Start speaking naturally. OpenCode will listen, answer, and keep the loop going.'}
            </Text>
          </View>

          <Button
            mode="contained"
            icon="phone-hangup"
            buttonColor="#E8ECEA"
            textColor="#0F1715"
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
    backgroundColor: '#DDF7F6',
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
