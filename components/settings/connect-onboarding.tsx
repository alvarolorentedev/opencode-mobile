import { SettingButton as Button } from './sections/setting-rows';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ActivityIndicator, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { Fonts } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';
import { CONNECT_LEARN_MORE_URL } from '@/lib/connect';
import type { ConnectSetup } from '@/providers/use-connect-state';

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
  const heading = <View style={styles.heading}>
    <View testID="connect-illustration" style={[styles.illustration, { height: illustrationHeight }]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image key={desktop ? 'desktop' : 'devices'} source={desktop ? require('@/assets/images/cloud-link-desktop.png') : require('@/assets/images/cloud-link-devices.png')} style={styles.image} contentFit="contain" />
      {step === 4 ? <Image source={require('@/assets/images/cloud-link-scan-frame.png')} tintColor={palette.tint} style={[styles.scanFrame, { width: illustrationHeight * 1.22, height: illustrationHeight * 0.82, top: illustrationHeight * 0.025 }]} contentFit="contain" /> : null}
    </View>
    <Text testID="connect-step-heading" accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{t(`settings:connect.onboarding.step${step}.title`)}</Text>
    <Text testID="connect-step-subheading" style={[styles.subtitle, { color: palette.text }]}>{t(`settings:connect.onboarding.step${step}.subtitle`)}</Text>
  </View>;
  return <View testID={`connect-step-${step}`} style={styles.screen}>
    <View style={styles.progress}>
      <View style={styles.segments} accessible={false}>{[1, 2, 3, 4].map((value) => <View key={value} style={[styles.segment, { backgroundColor: value <= step ? palette.tint : palette.border }]} />)}</View>
      <Text testID="connect-step-indicator" style={{ color: palette.muted }} variant="bodySmall">{t('settings:connect.onboarding.step', { step, total: 4 })}</Text>
    </View>
    {step === 3 ? <ConnectSubscription setup={setup} onboardingHeader={heading} /> : <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {heading}
        {step === 1 ? <View style={styles.details}>
          <Text style={{ color: palette.muted }}>{t('settings:connect.onboarding.explanation')}</Text>
          {[1, 2, 3].map((value) => <View key={value} style={styles.instruction}>
            <View style={[styles.number, { borderColor: palette.border }]}><Text style={{ color: palette.text }}>{value}</Text></View>
            <Text style={[styles.instructionText, { color: palette.text }]}>{t(`settings:connect.onboarding.instruction${value}`)}</Text>
          </View>)}
        </View> : null}
        {step === 2 ? <View style={styles.details}>
          <Text style={{ color: palette.muted }}>{t('settings:connect.onboarding.openOnComputer')}</Text>
          <Button testID="connect-copy-setup-url" mode="outlined" icon={copied ? 'check' : 'content-copy'} contentStyle={styles.urlContent} labelStyle={styles.urlLabel} style={{ borderColor: palette.border }} onPress={() => {
            void Clipboard.setStringAsync(CONNECT_LEARN_MORE_URL).then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true));
          }} accessibilityLabel={t(copied ? 'settings:connect.onboarding.copied' : 'settings:connect.onboarding.copySetupUrl')}>opencodecloud.link</Button>
          {copyError ? <HelperText type="error">{t('settings:connect.onboarding.copyError')}</HelperText> : null}
          <Text style={{ color: palette.muted }}>{t('settings:connect.onboarding.downloadHint')}</Text>
        </View> : null}
        {step === 4 ? <View style={styles.details}>
          <Text style={{ color: palette.muted }}>{t('settings:connect.onboarding.approveHint')}</Text>
          {pending ? <View style={styles.instruction}><ActivityIndicator size="small" /><Text testID="connect-progress" style={[styles.instructionText, { color: palette.text }]}>{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
        </View> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {step === 4 ? <Button testID="connect-options" mode="text" disabled={pending} onPress={onOptions} contentStyle={styles.secondary} labelStyle={styles.actionLabel}>{t('settings:connect.onboarding.usePairingLink')}</Button> : null}
        <Button testID={step === 4 ? 'connect-start-scan' : 'connect-next'} mode="contained" disabled={pending || (step === 4 && (setup.initialization !== 'ready' || !setup.entitled))} onPress={step === 4 ? onScan : onNext} style={styles.primaryButton} contentStyle={styles.primary} labelStyle={styles.actionLabel}>{t(`settings:connect.onboarding.step${step}.action`)}</Button>
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  progress: { alignItems: 'center', gap: 12, paddingTop: 4, paddingBottom: 16 },
  segments: { flexDirection: 'row', gap: 8 },
  segment: { width: 40, height: 6, borderRadius: 3 },
  content: { paddingHorizontal: 24, paddingBottom: 24 },
  heading: { gap: 12 },
  illustration: { height: 160, marginBottom: 12, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  scanFrame: { position: 'absolute', alignSelf: 'center' },
  title: { fontFamily: Fonts.display, fontSize: 28, lineHeight: 34, fontWeight: '700', minHeight: 68 },
  subtitle: { fontSize: 16, lineHeight: 22, minHeight: 44 },
  details: { gap: 16, paddingTop: 24 },
  instruction: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  instructionText: { flex: 1 },
  number: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  urlContent: { minHeight: 52, flexDirection: 'row-reverse' },
  urlLabel: { fontSize: 18 },
  footer: { gap: 8, paddingHorizontal: 24, paddingTop: 12 },
  primary: { minHeight: 50 },
  primaryButton: { borderRadius: 25 },
  actionLabel: { fontSize: 16 },
  secondary: { minHeight: 44 },
});
