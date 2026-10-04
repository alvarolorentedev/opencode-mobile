import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnboarding } from '@/providers/opencode-contexts';
import { Fonts } from '@/constants/theme';
import { usePalette } from '@/providers/theme-provider';
/**
 * Shared chrome for every onboarding step: back affordance, step progress,
 * title/subtitle, a scrollable body, and a pinned footer for the primary
 * action. Keeping it in one place keeps the six steps short and consistent.
 */
export function OnboardingStep({
  step,
  totalSteps,
  title,
  subtitle,
  onBack,
  children,
  footer,
  footerSingleLine = false,
  testID,
  scrollEnabled = true,
}: {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
  footer: ReactNode;
  footerSingleLine?: boolean;
  testID?: string;
  scrollEnabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const palette = usePalette();
  const { onboardingActive } = useOnboarding();
  const progress = Math.max(0, Math.min(1, step / totalSteps));

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]} testID={testID}>
      <Appbar.Header
        statusBarHeight={0}
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]}
        elevated>
        {onBack ? <Appbar.BackAction accessibilityLabel={t('common:actions.back')} onPress={onBack} /> : null}
        <Appbar.Content
          title={`${onboardingActive ? `${t('onboarding:reviewSetup')} · ` : ''}${t('onboarding:stepIndicator', { step, totalSteps })}`}
          titleStyle={{ color: palette.muted, fontSize: 14 }}
        />
      </Appbar.Header>

      <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
        <View style={[styles.progressValue, { backgroundColor: palette.tint, width: `${progress * 100}%` }]} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        style={styles.body}
        contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{title}</Text>
          {subtitle ? <Text variant="bodyMedium" style={{ color: palette.muted }}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>

      <View style={[styles.footer, footerSingleLine && styles.footerSingleLine, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { elevation: 0 },
  progressTrack: { height: 3, width: '100%' },
  progressValue: { height: 3 },
  body: { flex: 1, width: '100%', maxWidth: 800, alignSelf: 'center' },
  content: { gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  heading: { gap: 8 },
  title: { fontFamily: Fonts.display, fontWeight: '700' },
  footer: { borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 12 },
  footerSingleLine: { flexWrap: 'nowrap' },
});
