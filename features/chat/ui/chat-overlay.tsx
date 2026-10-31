import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationConfirmation , ConversationWave } from '@/features/voice/index';
import { Fonts, getColors } from '@/shared/ui/theme/theme';
import { useAppearance } from '@/shared/ui/theme/appearance-context';
import type { ConversationConfirmationState, ConversationInputPhase, ConversationPhase, ConversationReadbackPhase } from '@/features/voice/index';

const PHASE_LABEL_KEYS = {
  off: 'chat:overlay.phaseOff',
  armed: 'chat:overlay.phaseArmed',
  listening: 'chat:overlay.phaseListening',
  confirming: 'chat:overlay.phaseConfirming',
  submitting: 'chat:overlay.phaseSubmitting',
  waiting: 'chat:overlay.phaseWaiting',
  speaking: 'chat:overlay.phaseSpeaking',
} as const;

export function ConversationOverlay({
  confirmation,
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
  confirmation?: ConversationConfirmationState;
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
    <KeyboardAvoidingView accessibilityViewIsModal behavior="padding" testID="conversation-overlay" style={[styles.overlay, { backgroundColor: palette.background, paddingTop: insetsTop + 22, paddingBottom: Math.max(insets.bottom, 20), paddingLeft: Math.max(insets.left, 22), paddingRight: Math.max(insets.right, 22) }]}>
      <ScrollView className={cn(stylesClasses.scroll)} contentContainerStyle={styles.content}>
        <View className={cn(stylesClasses.header)}>
          <Text className={cn("text-muted-foreground")} style={[styles.eyebrow]} variant="description">{t('chat:overlay.conversationMode')}</Text>
          <Text numberOfLines={2} className={cn("text-foreground")} style={[styles.title]} variant="display">{sessionTitle}</Text>
        </View>

        <View className={cn(stylesClasses.hero)}>
          <View className={cn(stylesClasses.meta)}>
            <Text accessibilityLiveRegion="polite" style={[styles.phase, { color: disconnected ? palette.warning : palette.tint }]} variant="display">{phaseLabel}</Text>
            {!disconnected && phase === 'listening' ? (
              <Text className={cn(stylesClasses.hint, "text-muted-foreground")} variant="body">{t('chat:overlay.listeningHint')}</Text>
            ) : null}
          </View>
          <ConversationWave phase={disconnected ? 'off' : phase} level={level} tint={palette.tint} accent={palette.accent} height={waveHeight} />
          {feedback ? <Text accessibilityLiveRegion="polite" className={cn(stylesClasses.hint, "text-warning")} variant="description">{feedback}</Text> : null}
        </View>

        {confirmation?.active ? (
          <ConversationConfirmation key={confirmation.text} confirmation={confirmation} palette={palette} />
        ) : (
          <View className={cn(stylesClasses.snippet)}>
            <Text className={cn("text-muted-foreground")} style={[styles.eyebrow]} variant="label">{t(showWakePhrase ? 'chat:overlay.wakePhrase' : 'chat:overlay.lastHeard')}</Text>
            <Text className={cn(stylesClasses.heard, "text-foreground")} variant="body">{showWakePhrase ? wakePhrase : latestUserText?.trim() || t('chat:overlay.startSpeaking')}</Text>
          </View>
        )}
      </ScrollView>

      <View className={cn(stylesClasses.footer)}>
        {steerHint ? <Text className={cn(stylesClasses.hint, "text-muted-foreground")} variant="description">{t('chat:overlay.steerHint', { phrase: wakePhrase })}</Text> : null}
        <Button testID="conversation-end" onPress={onStop} variant="default" className={cn(stylesClasses.endContent, "bg-primary")} ><Icon name={"phone-hangup"} size={20} color={palette.background} /><Text className={cn(stylesClasses.endLabel, "text-background")}>{t('chat:overlay.endConversation')}</Text></Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 12 },
  content: { flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  eyebrow: { letterSpacing: 2, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.display, fontWeight: '700' },
  phase: { fontFamily: Fonts.display, fontWeight: '700', textAlign: 'center' }
});

const stylesClasses = {
  "scroll": "flex-1",
  "header": "gap-2",
  "hero": "grow justify-center items-center gap-8 py-8",
  "meta": "items-center gap-3 w-full",
  "hint": "text-center",
  "snippet": "gap-3 pb-8",
  "heard": "text-[20px] leading-[29px]",
  "footer": "gap-4.5 pt-4.5 w-full max-w-150 self-center",
  "endContent": "min-h-13.5",
  "endLabel": "font-bold text-[16px] shrink"
} as const;
