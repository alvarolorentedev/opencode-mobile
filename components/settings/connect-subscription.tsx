import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldDescription } from '@/components/ui/text-field';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

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
  const offers = setup.offers.length ? <RadioGroup value={selected?.key ?? ''} onValueChange={setSelectedOffer}>
      {setup.offers.map((offer) => <View key={offer.key}>
        {onboardingHeader && setup.offers.length === 1 ? <View style={[styles.offer, { borderTopColor: palette.border }]}><Icon size={24} color={palette.tint} name={"cube-outline"}></Icon><Text testID={`connect-offer-${offer.key}`} className={cn("text-foreground flex-1")}>{`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`}</Text></View> : <View className="min-h-target flex-row items-center gap-3"><RadioGroupItem nativeID={offer.key} testID={`connect-offer-${offer.key}`} value={offer.key} disabled={pending} accessibilityLabel={`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`} /><Label htmlFor={offer.key} className="flex-1" onPress={() => { if (!pending) setSelectedOffer(offer.key); }}>{`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`}</Label></View>}
        {offer.phases.map((phase, index) => <Text className={cn("text-muted-foreground")} key={index}>{phase.price}{' '}/ {phase.period ? period(phase.period.value, phase.period.unit) : ''}{phase.cycles > 0 ? ` × ${phase.cycles}` : ''}</Text>)}
      </View>)}
    </RadioGroup> : null;
  const purchase = <Button testID="connect-purchase" disabled={!setup.canPurchase || setup.initialization !== 'ready' || !selected} onPress={() => { if (selected) void setup.purchase(selected.key); }} variant="default" className={cn(onboardingHeader && stylesClasses.primaryButton, onboardingHeader && stylesClasses.primary)}><Text className={cn(onboardingHeader && stylesClasses.actionLabel)}>{t(onboardingHeader ? 'settings:connect.onboarding.step3.action' : 'settings:connect.subscribe')}</Text></Button>;
  const restore = showRestore ? <Button testID="connect-restore" disabled={pending || !setup.storeReady || setup.initialization !== 'ready'} onPress={() => { void setup.restore(); }} variant="ghost" className={cn(stylesClasses.secondary)} ><Text className={cn(onboardingHeader && stylesClasses.actionLabel)}>{t('settings:connect.restore')}</Text></Button> : null;
  if (onboardingHeader) return <View className={cn("flex-1")}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {onboardingHeader}
      <View className={cn(stylesClasses.benefits)}>{['remote', 'pair'].map((benefit) => <View key={benefit} className={cn(stylesClasses.benefit)}><Icon size={24} color={palette.tint} name={benefit === 'remote' ? 'web' : 'cellphone'}></Icon><Text className={cn("text-foreground flex-1")}>{t(`settings:connect.onboarding.${benefit}`)}</Text></View>)}</View>
      {offers}
      <Text className={cn("text-muted-foreground")}>{t('settings:connect.onboarding.billing')}</Text>
      {pending || setup.initialization === 'loading' ? <View className={cn(stylesClasses.benefit)}><Spinner size="small" /><Text testID="connect-progress" className={cn("text-foreground flex-1")}>{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
      {setup.error ? <FieldDescription testID="connect-error" invalid={true}>{setup.error}</FieldDescription> : null}
      {setup.notice ? <FieldDescription testID="connect-notice" invalid={false}>{setup.notice}</FieldDescription> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={pending} onPress={() => void setup.retry()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button> : null}
    </ScrollView>
    <View className={cn(stylesClasses.footer)} style={[{ paddingBottom: Math.max(insets.bottom, 24) }]}>
      <Text className={cn("text-muted-foreground text-center")} variant="label">{t('settings:connect.onboarding.checkoutHint')}</Text>
      {restore}
      {purchase}
    </View>
  </View>;
  return <View className={cn("gap-3")}>
    <Text className={cn("text-foreground")}>{t('settings:connect.benefits')}</Text>
    {setup.pairing ? <Text className={cn("text-foreground")} testID="connect-machine-name" variant="title">{setup.pairing.machineName}</Text> : null}
    {offers}
    {purchase}
    {restore}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  offer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }
});

const stylesClasses = {
  "primaryButton": "rounded-[25px]",
  "primary": "min-h-12.5",
  "actionLabel": "text-[16px]",
  "secondary": "min-h-11",
  "benefits": "gap-3 pt-3",
  "benefit": "flex-row items-center gap-4",
  "footer": "gap-2 px-6 pt-3"
} as const;
