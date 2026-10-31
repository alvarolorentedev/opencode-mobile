import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { FieldDescription } from '@/shared/ui/text-field';
import { Spinner } from '@/shared/ui/spinner';

import * as Clipboard from '@/shared/platform/clipboard';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectSubscription } from '@/features/cloud-link/ui/connect-subscription';
import { Fonts } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { CONNECT_LEARN_MORE_URL } from '@/shared/contracts/cloud-link';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';

export function ConnectOnboarding({ step, setup, onNext, onScan, onOptions }: {
  step: number;
  setup: ConnectSetup;
  onNext: () => void;
  onScan: () => void;
  onOptions: () => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const illustrationHeight = height < 760 ? 96 : 160;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const desktop = step === 2 || step === 4;
  const pending = setup.busy || ['purchasing', 'pending'].includes(setup.phase);
  const heading = <View className={cn(stylesClasses.heading)}>
    <View testID="connect-illustration" className={cn(stylesClasses.illustration)} style={[{ height: illustrationHeight }]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image key={desktop ? 'desktop' : 'devices'} source={desktop ? require('@/assets/images/cloud-link-desktop.png') : require('@/assets/images/cloud-link-devices.png')} className={cn(stylesClasses.image)} contentFit="contain" />
      {step === 4 ? <Image source={require('@/assets/images/cloud-link-scan-frame.png')} tintColor={palette.tint} className={cn(stylesClasses.scanFrame)} style={[{ width: illustrationHeight * 1.22, height: illustrationHeight * 0.82, top: illustrationHeight * 0.025 }]} contentFit="contain" /> : null}
    </View>
    <Text testID="connect-step-heading" accessibilityRole="header" className={cn("text-foreground")} style={[styles.title]}>{t(`settings:connect.onboarding.step${step}.title`)}</Text>
    <Text testID="connect-step-subheading" className={cn(stylesClasses.subtitle, "text-foreground")}>{t(`settings:connect.onboarding.step${step}.subtitle`)}</Text>
  </View>;
  return <View testID={`connect-step-${step}`} className={cn(stylesClasses.screen)}>
    <View className={cn(stylesClasses.progress)}>
      <View className={cn(stylesClasses.segments)} accessible={false}>{[1, 2, 3, 4].map((value) => <View key={value} className={cn(stylesClasses.segment)} style={[{ backgroundColor: value <= step ? palette.tint : palette.border }]} />)}</View>
      <Text testID="connect-step-indicator" className={cn("text-muted-foreground")} variant="label">{t('settings:connect.onboarding.step', { step, total: 4 })}</Text>
    </View>
    {step === 3 ? <ConnectSubscription setup={setup} onboardingHeader={heading} /> : <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {heading}
        {step === 1 ? <View className={cn(stylesClasses.details)}>
          <Text className={cn("text-muted-foreground")}>{t('settings:connect.onboarding.explanation')}</Text>
          {[1, 2, 3].map((value) => <View key={value} className={cn(stylesClasses.instruction)}>
            <View className={cn(stylesClasses.number, "border-border")}><Text className={cn("text-foreground")}>{value}</Text></View>
            <Text className={cn(stylesClasses.instructionText, "text-foreground")}>{t(`settings:connect.onboarding.instruction${value}`)}</Text>
          </View>)}
        </View> : null}
        {step === 2 ? <View className={cn(stylesClasses.details)}>
          <Text className={cn("text-muted-foreground")}>{t('settings:connect.onboarding.openOnComputer')}</Text>
          <Button testID="connect-copy-setup-url" onPress={() => {
            void Clipboard.setStringAsync(CONNECT_LEARN_MORE_URL).then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true));
          }} accessibilityLabel={t(copied ? 'settings:connect.onboarding.copied' : 'settings:connect.onboarding.copySetupUrl')} variant="outline" className={cn("border-border", stylesClasses.urlContent)} ><Icon name={copied ? 'check' : 'content-copy'} size={20} /><Text className={cn(stylesClasses.urlLabel)} >opencodecloud.link</Text></Button>
          {copyError ? <FieldDescription  invalid={true}>{t('settings:connect.onboarding.copyError')}</FieldDescription> : null}
          <Text className={cn("text-muted-foreground")}>{t('settings:connect.onboarding.downloadHint')}</Text>
        </View> : null}
        {step === 4 ? <View className={cn(stylesClasses.details)}>
          <Text className={cn("text-muted-foreground")}>{t('settings:connect.onboarding.approveHint')}</Text>
          {pending ? <View className={cn(stylesClasses.instruction)}><Spinner size="small" /><Text testID="connect-progress" className={cn(stylesClasses.instructionText, "text-foreground")}>{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
        </View> : null}
      </ScrollView>
      <View className={cn(stylesClasses.footer)} style={[{ paddingBottom: Math.max(insets.bottom, 24) }]}>
        {step === 4 ? <Button testID="connect-options" disabled={pending} onPress={onOptions} variant="ghost" className={cn(stylesClasses.secondary)} ><Text className={cn(stylesClasses.actionLabel)} >{t('settings:connect.onboarding.usePairingLink')}</Text></Button> : null}
        <Button testID={step === 4 ? 'connect-start-scan' : 'connect-next'} disabled={pending || (step === 4 && (setup.initialization !== 'ready' || !setup.entitled))} onPress={step === 4 ? onScan : onNext} variant="default" className={cn(stylesClasses.primaryButton, stylesClasses.primary)} ><Text className={cn(stylesClasses.actionLabel)} >{t(`settings:connect.onboarding.step${step}.action`)}</Text></Button>
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 24 },
  title: { fontFamily: Fonts.display, fontSize: 28, lineHeight: 34, fontWeight: '700', minHeight: 68 }
});

const stylesClasses = {
  "heading": "gap-3",
  "illustration": "h-40 mb-3 items-center justify-center",
  "image": "w-full h-full",
  "scanFrame": "absolute self-center",
  "subtitle": "text-[16px] leading-[22px] min-h-11",
  "screen": "flex-1 w-full max-w-120 self-center",
  "progress": "items-center gap-3 pt-1 pb-4",
  "segments": "flex-row gap-2",
  "segment": "w-10 h-1.5 rounded-[3px]",
  "details": "gap-4 pt-6",
  "instruction": "flex-row items-center gap-4",
  "number": "w-9 h-9 rounded-[18px] border items-center justify-center",
  "instructionText": "flex-1",
  "urlContent": "min-h-13 flex-row-reverse",
  "urlLabel": "text-[18px]",
  "footer": "gap-2 px-6 pt-3",
  "secondary": "min-h-11",
  "actionLabel": "text-[16px]",
  "primaryButton": "rounded-[25px]",
  "primary": "min-h-12.5"
} as const;
