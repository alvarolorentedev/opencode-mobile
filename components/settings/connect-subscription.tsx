import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Icon, RadioButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectSetup } from '@/providers/use-connect-state';
import { usePalette } from '@/hooks/use-palette';

export function ConnectSubscription({ setup, showRestore = true, onboardingHeader }: { setup: ConnectSetup; showRestore?: boolean; onboardingHeader?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [selectedOffer, setSelectedOffer] = useState('');
  const selected = setup.offers.find((offer) => offer.key === selectedOffer) ?? setup.offers[0];
  const pending = setup.busy || ['purchasing', 'pending', 'verifying', 'savingSession', 'finalizing'].includes(setup.phase);
  const period = (value: number, unit: string) => {
    try { return new Intl.NumberFormat(i18n.language, { style: 'unit', unit, unitDisplay: 'long' }).format(value); }
    catch { return `${value} ${unit}`; }
  };
  const offers = setup.offers.length ? <RadioButton.Group value={selected?.key ?? ''} onValueChange={setSelectedOffer}>
      {setup.offers.map((offer) => <View key={offer.key}>
        {onboardingHeader && setup.offers.length === 1 ? <View style={[styles.offer, { borderTopColor: palette.border }]}><Icon source="cube-outline" size={24} color={palette.tint} /><Text testID={`connect-offer-${offer.key}`} style={{ color: palette.text, flex: 1 }}>{`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`}</Text></View> : <RadioButton.Item labelStyle={{ color: palette.text }} testID={`connect-offer-${offer.key}`} label={`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`} value={offer.key} disabled={pending} />}
        {offer.phases.map((phase, index) => <Text style={{ color: palette.muted }} key={index}>{phase.price} / {phase.period ? period(phase.period.value, phase.period.unit) : ''}{phase.cycles > 0 ? ` × ${phase.cycles}` : ''}</Text>)}
      </View>)}
    </RadioButton.Group> : null;
  const purchase = <Button testID="connect-purchase" mode="contained" style={onboardingHeader ? styles.primaryButton : undefined} labelStyle={onboardingHeader ? styles.actionLabel : undefined} contentStyle={onboardingHeader ? styles.primary : undefined} disabled={!setup.canPurchase || setup.initialization !== 'ready' || !selected} onPress={() => { if (selected) void setup.purchase(selected.key); }}>{t(onboardingHeader ? 'settings:connect.onboarding.step3.action' : 'settings:connect.subscribe')}</Button>;
  const restore = showRestore ? <Button testID="connect-restore" mode="text" labelStyle={onboardingHeader ? styles.actionLabel : undefined} contentStyle={styles.secondary} disabled={pending || !setup.storeReady || setup.initialization !== 'ready'} onPress={() => { void setup.restore(); }}>{t('settings:connect.restore')}</Button> : null;
  if (onboardingHeader) return <View style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {onboardingHeader}
      <View style={styles.benefits}>{['remote', 'pair'].map((benefit) => <View key={benefit} style={styles.benefit}><Icon source={benefit === 'remote' ? 'web' : 'cellphone'} size={24} color={palette.tint} /><Text style={{ color: palette.text, flex: 1 }}>{t(`settings:connect.onboarding.${benefit}`)}</Text></View>)}</View>
      {offers}
      <Text style={{ color: palette.muted }}>{t('settings:connect.onboarding.billing')}</Text>
      {pending || setup.initialization === 'loading' ? <View style={styles.benefit}><ActivityIndicator size="small" /><Text testID="connect-progress" style={{ color: palette.text, flex: 1 }}>{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={pending} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
    </ScrollView>
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
      <Text style={{ color: palette.muted, textAlign: 'center' }} variant="bodySmall">{t('settings:connect.onboarding.checkoutHint')}</Text>
      {restore}
      {purchase}
    </View>
  </View>;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: palette.text }}>{t('settings:connect.benefits')}</Text>
    {setup.pairing ? <Text style={{ color: palette.text }} testID="connect-machine-name" variant="titleMedium">{setup.pairing.machineName}</Text> : null}
    {offers}
    {purchase}
    {restore}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  benefits: { gap: 12, paddingTop: 12 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  offer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  footer: { gap: 8, paddingHorizontal: 24, paddingTop: 12 },
  primary: { minHeight: 50 },
  primaryButton: { borderRadius: 25 },
  actionLabel: { fontSize: 16 },
  secondary: { minHeight: 44 },
});
