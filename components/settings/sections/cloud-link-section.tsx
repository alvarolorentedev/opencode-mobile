import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import { ListRow } from '@/components/ui/list-row';
import { FieldDescription } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';

import { SettingTarget } from '../settings-panel';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, View } from 'react-native';


import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { ServicesSection } from '@/components/settings/sections/services-section';
import { CONNECT_LEARN_MORE_URL } from '@/lib/connect';
import type { ManagedService } from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';
import type { ConnectSetup } from '@/providers/use-connect-state';
import { Palette } from './setting-rows';

// Consolidated Cloud Link surface: verified access status, the connector's
// exposed services, store subscription management, and owned machines, in that
// order. Services belong to a saved Cloud Link machine, which the provider
// resolves even when it is not the active connection, so the group is always
// rendered and explains itself when no machine or credentials are available.
export function CloudLinkSection({ setup, services, palette, onManageMachines, onAddService, onEditService }: {
  setup: ConnectSetup;
  services?: ServiceManagementApi;
  palette: Palette;
  onManageMachines: () => void;
  onAddService: () => void;
  onEditService: (service: ManagedService) => void;
}) {
  const { t, i18n } = useTranslation();
  const pending = setup.busy || ['purchasing', 'pending', 'verifying', 'savingSession', 'finalizing'].includes(setup.phase);
  const disabled = pending || setup.initialization !== 'ready' || !setup.storeReady;
  const status = setup.initialization === 'loading'
    ? t('settings:connect.progress.idle')
    : setup.entitled ? t('common:labels.active') : t('settings:subscription.inactive');
  const actionColor = disabled ? palette.muted : palette.tint;

  return <View testID="subscription-section" className={cn(stylesClasses.section)}>
    <View className={cn(stylesClasses.summary, "bg-surface-alt")}>
      <View className={cn(stylesClasses.summaryHeader)}>
        <Icon size={28} color={palette.tint} name={"cloud-outline"}></Icon>
        <Text className={cn(stylesClasses.name, "text-foreground")} variant="title">{t('settings:connect.title')}</Text>
        <View className={cn(stylesClasses.status)}>
          {setup.initialization === 'loading' ? <Spinner size="small" /> : <Icon size={10} color={setup.entitled ? palette.success : palette.muted} name={"circle"}></Icon>}
          <Text testID="subscription-status" className={cn("text-foreground shrink")}>{status}</Text>
        </View>
      </View>
      {setup.subscriptionExpiresAt ? <Text testID="subscription-expiry" className={cn("text-muted-foreground")} variant="description">{t('settings:subscription.accessThrough', { date: new Date(setup.subscriptionExpiresAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) })}</Text> : null}
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:subscription.description')}</Text>
    </View>

    {services ? <SettingTarget label={t('settings:services.title')}><ServicesSection api={services} palette={palette} onAddService={onAddService} onEditService={onEditService} /></SettingTarget> : null}

    <View>
      <Text className={cn(stylesClasses.groupTitle, "text-muted-foreground")} variant="description">{t('settings:screen.categories.subscription')}</Text>
      {!setup.entitled && setup.initialization === 'ready' ? <ConnectSubscription setup={setup} showRestore={false} /> : null}
      <SettingTarget label={t('settings:subscription.manage')}><ListRow testID="subscription-manage" accessibilityRole="button" disabled={disabled} onPress={() => void setup.manageSubscription()} title={t('settings:subscription.manage')} description={t(Platform.OS === 'ios' ? 'settings:subscription.opensApple' : 'settings:subscription.opensGoogle')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={{ opacity: disabled ? 0.45 : 1 }} left={(props) => <Icon {...props} color={actionColor} name={"credit-card-outline"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"open-in-new"}></Icon>}></ListRow></SettingTarget>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border }} />
      <SettingTarget label={t('settings:connect.restore')}><ListRow testID="connect-restore" accessibilityRole="button" disabled={disabled} onPress={() => void setup.restore()} title={t('settings:connect.restore')} description={t('settings:subscription.restoreDescription')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={{ opacity: disabled ? 0.45 : 1 }} left={(props) => <Icon {...props} color={actionColor} name={"restore"}></Icon>}></ListRow></SettingTarget>
    </View>

    {pending ? <Text testID="connect-progress" className={cn("text-foreground")}>{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
    {setup.error ? <FieldDescription testID="connect-error" invalid={true}>{setup.error}</FieldDescription> : null}
    {setup.notice ? <FieldDescription testID="connect-notice" invalid={false}>{setup.notice}</FieldDescription> : null}
    {setup.canRetry ? <Button testID="connect-retry" disabled={pending} onPress={() => void setup.retry()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button> : null}

    <View>
      <Text className={cn(stylesClasses.groupTitle, "text-muted-foreground")} variant="description">{t('settings:subscription.machines')}</Text>
      <SettingTarget label={t('settings:connect.machines')}><ListRow testID="subscription-machines" accessibilityRole="button" disabled={pending} onPress={onManageMachines} title={t('settings:connect.machines')} description={t('settings:subscription.machinesDescription')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={{ opacity: pending ? 0.45 : 1 }} left={(props) => <Icon {...props} color={pending ? palette.muted : palette.tint} name={"monitor"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"chevron-right"}></Icon>}></ListRow></SettingTarget>
    </View>

    <ListRow testID="cloud-link-learn-more" accessibilityRole="button" onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)} title={t('settings:connect.learnMore')} titleStyle={{ color: palette.text }} left={(props) => <Icon {...props} color={palette.tint} name={"information-outline"}></Icon>} right={(props) => <Icon {...props} color={palette.muted} name={"open-in-new"}></Icon>}></ListRow>
  </View>;
}



const stylesClasses = {
  "section": "gap-5 pb-2",
  "summary": "p-4 rounded-[14px] gap-3",
  "summaryHeader": "flex-row items-center flex-wrap gap-3",
  "name": "grow",
  "status": "flex-row items-center gap-2 shrink",
  "groupTitle": "mb-2 mx-1"
} as const;
