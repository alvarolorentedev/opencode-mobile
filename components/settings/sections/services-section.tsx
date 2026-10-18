import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, List, Text } from 'react-native-paper';

import {
  MAX_MANAGED_SERVICES,
  buildServiceShareUrl,
  formatServiceAddress,
  type ManagedService,
} from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';
import { SettingSelectField, type Palette } from './setting-rows';

// Presentational surface for the connector's remote service management API.
// Services belong to one Cloud Link machine; the provider resolves that target
// (which may differ from the active connection) and owns every read/write.
// This component only owns transient UI state and list rendering.
export function ServicesSection({ api, palette, onAddService, onEditService }: {
  api: ServiceManagementApi;
  palette: Palette;
  onAddService: () => void;
  onEditService: (service: ManagedService) => void;
}) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info'; message: string }>();
  const [busyId, setBusyId] = useState<string>();
  const [isActivating, setIsActivating] = useState(false);

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
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('settings:services.removeConfirm', { name: label }))) await remove();
      return;
    }
    Alert.alert(t('settings:services.removeTitle', { name: label }), t('settings:services.removeMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.remove'), style: 'destructive', onPress: () => void remove() },
    ]);
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

  return (
    <View testID="services-section" style={styles.section}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:services.title')}</Text>
        <Button compact loading={api.isRefreshing} disabled={api.isSaving || !api.available} onPress={() => void api.refresh()}>{t('common:actions.refresh')}</Button>
      </View>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:services.description')}</Text>

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
        <View style={[styles.target, { borderColor: palette.border, backgroundColor: palette.background }]}>
          <Text variant="bodyMedium" style={{ color: palette.text }}>
            {t('settings:services.notActive', { name: api.target.machineName || api.target.serverUrl })}
          </Text>
          <Button testID="service-use-machine" compact mode="contained-tonal" loading={isActivating} disabled={isActivating}
            onPress={() => void activateTarget()}>
            {t('settings:services.useMachine')}
          </Button>
        </View>
      ) : null}

      {version && version.api < 2 ? (
        <HelperText testID="services-connector-hint" type="info">
          {version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}
        </HelperText>
      ) : null}

      {!api.available && api.unavailableReason === 'no-cloud-link-machine' ? (
        <HelperText testID="services-no-machine" type="info">{t('settings:services.noMachine')}</HelperText>
      ) : null}
      {!api.available && api.unavailableReason === 'credentials-expired' ? (
        <View style={styles.expired}>
          <HelperText testID="services-credentials-expired" type="error">{t('settings:services.credentialsExpired')}</HelperText>
          <Button testID="service-reconnect" compact mode="outlined" loading={isActivating} disabled={isActivating}
            onPress={() => void activateTarget()}>
            {t('common:actions.reconnect')}
          </Button>
        </View>
      ) : null}

      <Button testID="service-add" mode="contained-tonal" icon="plus" disabled={atCapacity || api.isSaving || !api.available} onPress={onAddService}>
        {t('settings:services.add')}
      </Button>
      {atCapacity ? <HelperText type="info">{t('settings:services.capacity', { max: MAX_MANAGED_SERVICES })}</HelperText> : null}

      {api.available && api.services.length === 0
        ? <HelperText type="info">{t('settings:services.empty')}</HelperText>
        : api.services.map((service) => {
          const url = shareUrl(service);
          return (
            <View key={service.id} testID={`service-${service.id}`} style={[styles.service, { backgroundColor: palette.background, borderColor: palette.border }]}>
              <List.Item
                title={service.name || service.id}
                description={<View style={styles.serviceDescription}>
                  {url ? <Text variant="bodySmall" numberOfLines={1} style={{ color: palette.muted }}>{url}</Text> : null}
                  <Text variant="bodySmall" numberOfLines={1} style={{ color: palette.muted }}>{formatServiceAddress(service)} → {service.target}</Text>
                </View>}
                titleStyle={{ color: palette.text }}
                descriptionStyle={{ color: palette.muted }}
                right={() => <View style={styles.chips}><Chip compact>{t(`settings:services.access.${service.access}`)}</Chip><Chip compact>{service.enabled ? t('common:labels.enabled') : t('common:labels.off')}</Chip></View>}
              />
              <View style={styles.actions}>
                <Button compact disabled={api.isSaving} onPress={() => onEditService(service)}>{t('common:actions.edit')}</Button>
                <Button compact disabled={api.isSaving} onPress={() => void copyLink(service)}>{t('settings:services.copyLink')}</Button>
                <Button compact disabled={api.isSaving} loading={busyId === service.id} onPress={() => void confirmRemove(service)}>{t('common:actions.remove')}</Button>
              </View>
            </View>
          );
        })}

      {feedback ? <HelperText testID="services-feedback" type={feedback.type}>{feedback.message}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontWeight: '600' },
  target: { borderRadius: 14, borderWidth: 1, gap: 10, padding: 12 },
  expired: { alignItems: 'flex-start', gap: 4 },
  service: { borderRadius: 14, borderWidth: 1, padding: 8 },
  serviceDescription: { gap: 2 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
