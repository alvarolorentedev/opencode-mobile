import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, RadioButton, Text } from 'react-native-paper';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectSubscription({ setup, showRestore = true }: { setup: ConnectSetup; showRestore?: boolean }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const [selectedOffer, setSelectedOffer] = useState('');
  const selected = setup.offers.find((offer) => offer.key === selectedOffer) ?? setup.offers[0];
  const pending = setup.busy || ['purchasing', 'pending', 'verifying', 'savingSession', 'finalizing'].includes(setup.phase);
  const period = (value: number, unit: string) => {
    try { return new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(value); }
    catch { return `${value} ${unit}`; }
  };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: palette.text }}>{t('settings:connect.benefits')}</Text>
    {setup.pairing ? <Text style={{ color: palette.text }} testID="connect-machine-name" variant="titleMedium">{setup.pairing.machineName}</Text> : null}
    {setup.offers.length ? <RadioButton.Group value={selected?.key ?? ''} onValueChange={setSelectedOffer}>
      {setup.offers.map((offer) => <View key={offer.key}>
        <RadioButton.Item labelStyle={{ color: palette.text }} testID={`connect-offer-${offer.key}`} label={`${offer.title} — ${offer.displayPrice}${offer.period ? ` / ${period(offer.period.value, offer.period.unit)}` : ''}`} value={offer.key} disabled={pending} />
        {offer.phases.map((phase, index) => <Text style={{ color: palette.muted }} key={index}>{phase.price} / {phase.period ? period(phase.period.value, phase.period.unit) : ''}{phase.cycles > 0 ? ` × ${phase.cycles}` : ''}</Text>)}
      </View>)}
    </RadioButton.Group> : null}
    <Button testID="connect-purchase" mode="contained" disabled={!setup.canPurchase || !selected} onPress={() => { if (selected) void setup.purchase(selected.key); }}>{t('settings:connect.subscribe')}</Button>
    {showRestore ? <Button testID="connect-restore" disabled={pending || !setup.storeReady} onPress={() => { void setup.restore(); }}>{t('settings:connect.restore')}</Button> : null}
  </View>;
}
