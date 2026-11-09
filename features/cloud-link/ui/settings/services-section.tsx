import { cn } from '@/shared/ui/cn';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { Badge } from '@/shared/ui/badge';
import { SettingSelectField, type Palette } from '@/shared/ui/settings/setting-rows';
import * as Clipboard from '@/shared/platform/clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import {
  MAX_MANAGED_SERVICES,
  buildServiceShareUrl,
  formatServiceAddress,
  type ManagedService,
} from '@/shared/contracts/service-management';
import {
  SERVICE_ACCESS_CONNECTOR_VERSION,
  formatServiceRemaining,
  getServiceAccessMode,
  getServiceRemainingSeconds,
  getServiceServerNow,
  supportsServiceAccess,
} from '@/shared/contracts/service-access';
import type { ServiceManagementApi } from '@/shared/contracts/domain';

// Presentational surface for the connector's remote service management API.
// Services belong to one Cloud Link machine; the provider resolves that target
// (which may differ from the active connection) and owns every read/write.
// This component only owns transient UI state and list rendering.
//
// Expiration countdowns run off the connector clock while the section is
// mounted; they are never derived from the phone clock.
export function ServicesSection({ api, palette, onAddService, onEditService }: {
  api: ServiceManagementApi;
  palette: Palette;
  onAddService: () => void;
  onEditService: (service: ManagedService) => void;
}) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info'; message: string }>();
  const [busyId, setBusyId] = useState<string>();
  const [isActivating, setIsActivating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const accessSupported = supportsServiceAccess(api.version);
  const hasDeadline = api.services.some((service) => service.access_policy?.expires_at !== null && service.access_policy?.expires_at !== undefined);

  // Tick only while a timed share exists and this section is on screen.
  useEffect(() => {
    if (!hasDeadline) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [hasDeadline]);
  const serverNow = getServiceServerNow(api.serverTime, api.serverTimeAt, now);

  const atCapacity = api.services.length >= MAX_MANAGED_SERVICES;
  const version = api.version;
  const targetProfileId = api.target?.profileId ?? api.machines.find((machine) => machine.isActive)?.id;

  async function activateTarget() {
    setIsActivating(true);
    setFeedback(undefined);
    try {
      await api.activateTarget();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:services.reconnectFailed') });
    } finally {
      setIsActivating(false);
    }
  }

  async function confirmRemove(service: ManagedService) {
    const label = service.name || service.id;
    const remove = async () => {
      setBusyId(service.id);
      setFeedback(undefined);
      try {
        await api.remove(service.id);
        setFeedback({ type: 'info', message: t('settings:services.removed', { name: label }) });
      } catch (error) {
        setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:services.removeFailed') });
      } finally {
        setBusyId(undefined);
      }
    };
    confirmAction(t('settings:services.removeTitle', { name: label }), t('settings:services.removeMessage'), t('common:actions.remove'), t('common:actions.cancel'), () => void remove());
  }

  // Revocation stops external access immediately but leaves the service routed
  // for paired devices, so the confirmation says both halves out loud.
  function confirmRevoke(service: ManagedService) {
    const label = service.name || service.id;
    const revoke = async () => {
      setBusyId(service.id);
      setFeedback(undefined);
      try {
        await api.revoke(service.id);
        setFeedback({ type: 'info', message: t('settings:services.revoked', { name: label }) });
      } catch (error) {
        setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:services.revokeFailed') });
      } finally {
        setBusyId(undefined);
      }
    };
    confirmAction(t('settings:services.revokeTitle', { name: label }), t('settings:services.revokeMessage'), t('settings:services.revoke'), t('common:actions.cancel'), () => void revoke());
  }

  function shareUrl(service: ManagedService) {
    if (!api.target) return undefined;
    try {
      return buildServiceShareUrl(api.target.serverUrl, service);
    } catch {
      return undefined;
    }
  }

  async function copyLink(service: ManagedService) {
    const url = shareUrl(service);
    if (!url) {
      setFeedback({ type: 'error', message: t('settings:services.linkUnavailable') });
      return;
    }
    try {
      await Clipboard.setStringAsync(url);
      setFeedback({ type: 'info', message: t('settings:services.linkCopied') });
    } catch {
      setFeedback({ type: 'error', message: t('settings:services.linkUnavailable') });
    }
  }

  async function openLink(service: ManagedService) {
    const url = shareUrl(service);
    if (!url) {
      setFeedback({ type: 'error', message: t('settings:services.linkUnavailable') });
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setFeedback({ type: 'error', message: t('settings:services.openFailed') });
    }
  }

  return <>{confirmation}{(
    <View testID="services-section" className={cn(stylesClasses.section)}>
      <Text className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:services.title')}</Text>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:services.description')}</Text>

      {api.loadFailed ? (
        <View className={cn(stylesClasses.loadFailure)}>
          <FieldDescription  invalid={true}>{t('settings:services.loadFailed')}</FieldDescription>
          <Button onPress={() => void api.refresh()} variant="outline"><Text>{t('common:actions.retry')}</Text></Button>
        </View>
      ) : null}

      {api.machines.length > 1 ? (
        <SettingSelectField
          testID="service-machine-select"
          label={t('settings:services.machine')}
          valueLabel={api.machines.find((machine) => machine.id === targetProfileId)?.name ?? t('common:labels.none')}
          selectedValue={targetProfileId}
          onValueChange={(value) => api.selectMachine(value)}
          options={api.machines.map((machine) => ({ value: machine.id, label: machine.name }))}
          palette={palette}
        />
      ) : null}

      {api.target && !api.target.isActiveConnection ? (
        <View className={cn(stylesClasses.target, "border-border bg-background")}>
          <Text className={cn("text-foreground")} variant="description">{t('settings:services.notActive', { name: api.target.machineName || api.target.serverUrl })}</Text>
          <Button testID="service-use-machine" disabled={isActivating} onPress={() => void activateTarget()} variant="secondary">{isActivating ? <Spinner size="small" /> : null}<Text>{t('settings:services.useMachine')}</Text></Button>
        </View>
      ) : null}

      {version && version.api < 2 ? (
        <FieldDescription testID="services-connector-hint" invalid={false}>{version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}</FieldDescription>
      ) : null}
      {version && !accessSupported ? (
        <FieldDescription testID="services-access-hint" invalid={false}>{t('settings:services.expiration.updateConnector', { version: SERVICE_ACCESS_CONNECTOR_VERSION })}</FieldDescription>
      ) : null}

      {!api.available && api.unavailableReason === 'no-cloud-link-machine' ? (
        <FieldDescription testID="services-no-machine" invalid={false}>{t('settings:services.noMachine')}</FieldDescription>
      ) : null}
      {!api.available && api.unavailableReason === 'credentials-expired' ? (
        <View className={cn(stylesClasses.expired)}>
          <FieldDescription testID="services-credentials-expired" invalid={true}>{t('settings:services.credentialsExpired')}</FieldDescription>
          <Button testID="service-reconnect" disabled={isActivating} onPress={() => void activateTarget()} variant="outline">{isActivating ? <Spinner size="small" /> : null}<Text>{t('common:actions.reconnect')}</Text></Button>
        </View>
      ) : null}

      <Button testID="service-add" disabled={atCapacity || api.isSaving || !api.available} onPress={onAddService} variant="secondary"><Icon name={"plus"} size={20} /><Text>{t('settings:services.add')}</Text></Button>
      {atCapacity ? <FieldDescription  invalid={false}>{t('settings:services.capacity', { max: MAX_MANAGED_SERVICES })}</FieldDescription> : null}

      {api.available && api.services.length === 0
        ? <FieldDescription  invalid={false}>{t('settings:services.empty')}</FieldDescription>
        : api.services.map((service) => {
          const url = shareUrl(service);
          const mode = getServiceAccessMode(service);
          const remaining = getServiceRemainingSeconds(service.access_policy, serverNow);
          const canRevoke = accessSupported && mode !== 'private';
          return (
            <View key={service.id} testID={`service-${service.id}`} className={cn(stylesClasses.service, "bg-background border-border")}>
              <ListRow title={service.name || service.id} description={<View className={cn(stylesClasses.serviceDescription)}>
                  {url ? <Text numberOfLines={1} className={cn("text-muted-foreground")} variant="label">{url}</Text> : null}
                  <Text numberOfLines={1} className={cn("text-muted-foreground")} variant="label">{formatServiceAddress(service)}{' → '}{service.target}</Text>
                  {mode === 'password' ? <Text numberOfLines={2} className={cn("text-muted-foreground")} variant="label">{t('settings:services.expiration.sharePassword')}</Text> : null}
                </View>} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <View className={cn(stylesClasses.chips)}>
                  <Badge variant="secondary" testID={`service-access-${service.id}`}><Text>{t(`settings:services.access.${mode}`)}</Text></Badge>
                  <Badge variant="secondary"><Text>{service.enabled ? t('common:labels.enabled') : t('common:labels.off')}</Text></Badge>
                  {remaining !== null ? <Badge variant={remaining === 0 ? 'destructive' : 'secondary'} testID={`service-expiration-${service.id}`}><Text>{remaining === 0 ? t('settings:services.expiration.expired') : t('settings:services.expiration.remaining', { time: formatServiceRemaining(remaining) })}</Text></Badge> : null}
                </View>}></ListRow>
              <View className={cn(stylesClasses.actions)}>
                <Button testID={`service-open-${service.id}`} disabled={api.isSaving || !url} onPress={() => void openLink(service)} variant="ghost"><Text>{t('settings:services.open')}</Text></Button>
                <Button testID={`service-copy-${service.id}`} disabled={api.isSaving || !url} onPress={() => void copyLink(service)} variant="ghost"><Text>{t('settings:services.copyLink')}</Text></Button>
                <Button testID={`service-edit-${service.id}`} disabled={api.isSaving} onPress={() => onEditService(service)} variant="ghost"><Text>{t('common:actions.edit')}</Text></Button>
                <Button disabled={api.isSaving} onPress={() => void confirmRemove(service)} variant="ghost">{busyId === service.id ? <Spinner size="small" /> : null}<Text>{t('common:actions.remove')}</Text></Button>
                {canRevoke ? <Button testID={`service-revoke-${service.id}`} disabled={api.isSaving || busyId === service.id} onPress={() => void confirmRevoke(service)} variant="ghost"><Text>{t('settings:services.revoke')}</Text></Button> : null}
              </View>
            </View>
          );
        })}

      {feedback ? <FieldDescription testID="services-feedback" invalid={feedback.type === 'error'}>{feedback.message}</FieldDescription> : null}
    </View>
  )}</>;
}

const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "title": "font-semibold",
  "loadFailure": "items-start gap-1",
  "target": "rounded-[14px] border gap-2.5 p-3",
  "expired": "items-start gap-1",
  "service": "rounded-[14px] border p-2",
  "serviceDescription": "gap-0.5",
  "chips": "flex-row items-center gap-1 flex-wrap justify-end",
  "actions": "flex-row flex-wrap items-center justify-end gap-1"
} as const;
