import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { useCallback, type ReactNode } from 'react';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDismissOnBack } from '@/shared/ui/hooks/use-dismiss-on-back';
import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import type { OnboardingStepName } from '@/features/onboarding/ui/navigation';
import { useOnboarding } from '@/features/onboarding/context';
import { Fonts } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';

/**
 * Shared chrome for every onboarding step: back affordance, step progress,
 * title/subtitle, a scrollable body, and a pinned footer for the primary
 * action. Keeping it in one place keeps the steps short and consistent.
 */
export function OnboardingStep({
  step,
  title,
  subtitle,
  backDisabled = false,
  children,
  footer,
  footerSingleLine = false,
  testID,
  scrollEnabled = true,
}: {
  step: OnboardingStepName;
  title: string;
  subtitle?: string;
  backDisabled?: boolean;
  children: ReactNode;
  footer: ReactNode;
  footerSingleLine?: boolean;
  testID?: string;
  scrollEnabled?: boolean;
}) {
  const navigation = useOnboardingNavigation(step);
  const router = useRouter();
  const focused = useIsFocused();
  const onBack = backDisabled ? undefined : navigation.back;
  useDismissOnBack(Platform.OS === 'android' && focused && Boolean(onBack), () => onBack?.());
  useFocusEffect(useCallback(() => {
    if (!navigation.available) router.replace('/onboarding/general');
  }, [navigation.available, router]));
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const palette = usePalette();
  const { onboardingActive } = useOnboarding();
  const progress = Math.max(0, Math.min(1, navigation.step / navigation.totalSteps));

  return (
    <View className={cn(stylesClasses.screen, "bg-background")} testID={testID}>
      <ScreenHeader style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]} safeArea={false}>{onBack ? <Button accessibilityLabel={t('common:actions.back')} onPress={onBack} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} /></Button> : null}<HeaderTitle title={`${onboardingActive ? `${t('onboarding:reviewSetup')} · ` : ''}${t('onboarding:stepIndicator', { step: navigation.step, totalSteps: navigation.totalSteps })}`} textStyle={{ color: palette.muted, fontSize: 14 }}></HeaderTitle></ScreenHeader>

      <View className={cn(stylesClasses.progressTrack, "bg-border")}>
        <View className={cn(stylesClasses.progressValue)} style={[{ backgroundColor: palette.tint, width: `${progress * 100}%` }]} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        className={cn(stylesClasses.body)}
        contentContainerStyle={styles.content}>
        <View className={cn(stylesClasses.heading)}>
          <Text className={cn("text-foreground")} style={[styles.title]} variant="display">{title}</Text>
          {subtitle ? <Text className={cn("text-muted-foreground")} variant="description">{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>

      <View className={cn(stylesClasses.footer, footerSingleLine && stylesClasses.footerSingleLine)} style={[{ backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { elevation: 0 },
  content: { gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  title: { fontFamily: Fonts.display, fontWeight: '700' }
});

const stylesClasses = {
  "screen": "flex-1",
  "progressTrack": "h-0.75 w-full",
  "progressValue": "h-0.75",
  "body": "flex-1 w-full max-w-contentWidth self-center",
  "heading": "gap-2",
  "footer": "border-t flex-row flex-wrap gap-2.5 justify-end px-5 pt-3",
  "footerSingleLine": "flex-nowrap"
} as const;
