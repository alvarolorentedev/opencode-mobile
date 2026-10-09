import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Icon, List, Text } from 'react-native-paper';

import { ConnectSubscription } from '@/components/settings/connect-subscription';
import type { ConnectSetup } from '@/providers/use-connect-state';
import type { Palette } from './setting-rows';

export function SubscriptionSection({ setup, palette, onManageMachines }: {
  setup: ConnectSetup;
  palette: Palette;
  onManageMachines: () => void;
}) {
  const { t, i18n } = useTranslation();
  const pending = setup.busy || ['purchasing', 'pending', 'verifying', 'savingSession', 'finalizing'].includes(setup.phase);
  const disabled = pending || setup.initialization !== 'ready' || !setup.storeReady;
  const status = setup.initialization === 'loading'
    ? t('settings:connect.progress.idle')
    : setup.entitled ? t('common:labels.active') : t('settings:subscription.inactive');
  const actionColor = disabled ? palette.muted : palette.tint;

  return <View testID="subscription-section" style={styles.section}>
    <View style={[styles.summary, { backgroundColor: palette.surfaceAlt }]}>
      <View style={styles.summaryHeader}>
        <Icon source="crown-outline" size={28} color={palette.tint} />
        <Text variant="titleMedium" style={[styles.name, { color: palette.text }]}>{t('settings:connect.title')}</Text>
        <View style={styles.status}>
          {setup.initialization === 'loading' ? <ActivityIndicator size="small" /> : <Icon source="circle" size={10} color={setup.entitled ? palette.success : palette.muted} />}
          <Text testID="subscription-status" style={{ color: palette.text, flexShrink: 1 }}>{status}</Text>
        </View>
      </View>
      {setup.subscriptionExpiresAt ? <Text testID="subscription-expiry" variant="bodyMedium" style={{ color: palette.muted }}>
        {t('settings:subscription.accessThrough', { date: new Date(setup.subscriptionExpiresAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) })}
      </Text> : null}
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:subscription.description')}</Text>
    </View>

    <View>
      <Text variant="labelLarge" style={[styles.groupTitle, { color: palette.muted }]}>{t('settings:screen.categories.subscription')}</Text>
      {!setup.entitled && setup.initialization === 'ready' ? <ConnectSubscription setup={setup} showRestore={false} /> : null}
      <List.Item testID="subscription-manage" accessibilityRole="button" disabled={disabled} onPress={() => void setup.manageSubscription()}
        title={t('settings:subscription.manage')} description={t(Platform.OS === 'ios' ? 'settings:subscription.opensApple' : 'settings:subscription.opensGoogle')}
        titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} titleNumberOfLines={0} descriptionNumberOfLines={0} style={{ opacity: disabled ? 0.45 : 1 }}
        left={(props) => <List.Icon {...props} icon="credit-card-outline" color={actionColor} />} right={(props) => <List.Icon {...props} icon="open-in-new" color={palette.muted} />} />
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border }} />
      <List.Item testID="connect-restore" accessibilityRole="button" disabled={disabled} onPress={() => void setup.restore()}
        title={t('settings:connect.restore')} description={t('settings:subscription.restoreDescription')}
        titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} titleNumberOfLines={0} descriptionNumberOfLines={0} style={{ opacity: disabled ? 0.45 : 1 }}
        left={(props) => <List.Icon {...props} icon="restore" color={actionColor} />} />
    </View>

    {pending ? <Text testID="connect-progress" style={{ color: palette.text }}>{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
    {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
    {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
    {setup.canRetry ? <Button testID="connect-retry" disabled={pending} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}

    <View>
      <Text variant="labelLarge" style={[styles.groupTitle, { color: palette.muted }]}>{t('settings:subscription.machines')}</Text>
      <List.Item testID="subscription-machines" accessibilityRole="button" disabled={pending} onPress={onManageMachines}
        title={t('settings:connect.machines')} description={t('settings:subscription.machinesDescription')}
        titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} titleNumberOfLines={0} descriptionNumberOfLines={0} style={{ opacity: pending ? 0.45 : 1 }}
        left={(props) => <List.Icon {...props} icon="monitor" color={pending ? palette.muted : palette.tint} />} right={(props) => <List.Icon {...props} icon="chevron-right" color={palette.muted} />} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 20, paddingBottom: 8 },
  summary: { padding: 16, borderRadius: 14, gap: 12 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  name: { flexGrow: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  groupTitle: { marginBottom: 8, marginHorizontal: 4 },
});
