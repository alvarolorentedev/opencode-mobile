import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, List, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import {
  DEFAULT_SERVICES_PORT,
  MAX_MANAGED_SERVICES,
  buildServiceShareUrl,
  formatServiceAddress,
  getServicePortOptions,
  prepareServiceDraft,
  type ManagedService,
  type ServiceDraft,
  type ServiceDraftErrors,
  type ServicePortOption,
} from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

function draftFor(service?: ManagedService): ServiceDraft {
  return service
    ? { id: service.id, name: service.name, port: service.port, path: service.path ?? '', target: service.target, enabled: service.enabled, access: service.access, stripPrefix: service.strip_prefix }
    : { id: '', name: '', port: undefined, path: '', target: '', enabled: false, access: 'private', stripPrefix: true };
}

// Presentational surface for the connector's remote service management API. All
// reads/writes and the canonical stored values come from the provider's
// `services` domain; this component only owns form and transient UI state.
export function ServicesSection({ api, serverUrl, palette }: {
  api: ServiceManagementApi;
  serverUrl: string;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ServiceDraft>();
  const [editingId, setEditingId] = useState<string>();
  const [errors, setErrors] = useState<ServiceDraftErrors>({});
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info'; message: string }>();
  const [busyId, setBusyId] = useState<string>();

  const atCapacity = api.services.length >= MAX_MANAGED_SERVICES;
  const editing = editingId !== undefined;
  // Management revision 2 exposes dedicated ports and root services; older
  // (or pre-version) connectors stay on the legacy path-only surface.
  const version = api.version;
  const apiTwo = (version?.api ?? 0) >= 2;
  const servicePorts = version?.servicePorts?.length ? version.servicePorts : [DEFAULT_SERVICES_PORT];
  const isRoot = !draft?.path.trim();
  const portOptions = draft && apiTwo
    ? getServicePortOptions({ editingId, path: isRoot ? null : draft.path.trim(), servicePorts, services: api.services })
    : [];

  function portOptionLabel(option: ServicePortOption) {
    if (!option.usable) return `${option.port} (${t('settings:services.portOccupied')})`;
    if (option.shared) return `${option.port} (${t('settings:services.portShared')})`;
    return String(option.port);
  }

  function startCreate() {
    setEditingId(undefined);
    const options = apiTwo ? getServicePortOptions({ path: null, servicePorts, services: api.services }) : [];
    const port = apiTwo ? options.find((option) => option.usable)?.port ?? servicePorts[0] : DEFAULT_SERVICES_PORT;
    setDraft({ ...draftFor(), port });
    setErrors({});
    setFeedback(undefined);
  }

  function startEdit(service: ManagedService) {
    setEditingId(service.id);
    setDraft(draftFor(service));
    setErrors({});
    setFeedback(undefined);
  }

  function cancelEdit() {
    setDraft(undefined);
    setEditingId(undefined);
    setErrors({});
  }

  async function submitDraft() {
    if (!draft) return;
    const prepared = prepareServiceDraft(draft, {
      api: version?.api,
      servicePorts: version?.servicePorts,
      services: api.services,
    });
    setErrors(prepared.errors);
    if (!prepared.input) return;
    const id = editingId ?? draft.id.trim();
    setBusyId(id);
    setFeedback(undefined);
    try {
      const saved = await api.save(id, prepared.input);
      setFeedback({ type: 'info', message: t('settings:services.saved', { name: saved.name || saved.id }) });
      cancelEdit();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:services.saveFailed') });
    } finally {
      setBusyId(undefined);
    }
  }

  async function confirmRemove(service: ManagedService) {
    const label = service.name || service.id;
    const remove = async () => {
      setBusyId(service.id);
      setFeedback(undefined);
      try {
        await api.remove(service.id);
        if (editingId === service.id) cancelEdit();
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
    try {
      return buildServiceShareUrl(serverUrl, service);
    } catch {
      return undefined;
    }
  }

  async function copyLink(service: ManagedService) {
    try {
      await Clipboard.setStringAsync(buildServiceShareUrl(serverUrl, service));
      setFeedback({ type: 'info', message: t('settings:services.linkCopied') });
    } catch {
      setFeedback({ type: 'error', message: t('settings:services.linkUnavailable') });
    }
  }

  function fieldError(field: keyof ServiceDraftErrors) {
    const code = errors[field];
    return code ? t(`settings:services.errors.${code}`) : undefined;
  }

  return (
    <View testID="services-section" style={styles.section}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:services.title')}</Text>
        <Button compact loading={api.isRefreshing} disabled={api.isSaving} onPress={() => void api.refresh()}>{t('common:actions.refresh')}</Button>
      </View>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:services.description')}</Text>
      {version && version.api < 2 ? (
        <HelperText testID="services-connector-hint" type="info">
          {version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}
        </HelperText>
      ) : null}

      {draft ? (
        <View style={[styles.editor, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Text variant="labelLarge" style={{ color: palette.muted }}>{editing ? t('settings:services.editTitle') : t('settings:services.addTitle')}</Text>
          <TextInput testID="service-id-input" mode="outlined" disabled={editing} label={t('settings:services.fields.id')} value={draft.id}
            onChangeText={(value) => setDraft({ ...draft, id: value })} autoCapitalize="none" autoCorrect={false} />
          {fieldError('id') ? <HelperText type="error">{fieldError('id')}</HelperText> : null}
          <TextInput testID="service-name-input" mode="outlined" label={t('settings:services.fields.name')} value={draft.name}
            onChangeText={(value) => setDraft({ ...draft, name: value })} />
          {fieldError('name') ? <HelperText type="error">{fieldError('name')}</HelperText> : null}
          {apiTwo ? (
            <>
              <SettingSelectField
                testID="service-port-select"
                label={t('settings:services.fields.port')}
                valueLabel={draft.port !== undefined ? String(draft.port) : t('common:labels.none')}
                selectedValue={draft.port !== undefined ? String(draft.port) : undefined}
                onValueChange={(value) => setDraft({ ...draft, port: Number(value) })}
                options={portOptions.map((option) => ({ value: String(option.port), label: portOptionLabel(option) }))}
                palette={palette}
              />
              {fieldError('port') ? <HelperText type="error">{fieldError('port')}</HelperText> : null}
            </>
          ) : null}
          <TextInput testID="service-path-input" mode="outlined" label={t('settings:services.fields.path')} placeholder="/test/api" value={draft.path}
            onChangeText={(value) => setDraft({ ...draft, path: value })} autoCapitalize="none" autoCorrect={false} />
          {fieldError('path') ? <HelperText type="error">{fieldError('path')}</HelperText>
            : isRoot && apiTwo ? <HelperText type="info">{t('settings:services.rootPathHint')}</HelperText> : null}
          <TextInput testID="service-target-input" mode="outlined" label={t('settings:services.fields.target')} placeholder="127.0.0.1:3000" value={draft.target}
            onChangeText={(value) => setDraft({ ...draft, target: value })} autoCapitalize="none" autoCorrect={false} />
          {fieldError('target') ? <HelperText type="error">{fieldError('target')}</HelperText> : null}
          <SettingSelectField
            label={t('settings:services.fields.access')}
            valueLabel={t(`settings:services.access.${draft.access}`)}
            selectedValue={draft.access}
            onValueChange={(value) => setDraft({ ...draft, access: value })}
            options={[{ value: 'private', label: t('settings:services.access.private') }, { value: 'public', label: t('settings:services.access.public') }]}
            palette={palette}
          />
          <SettingSwitchRow title={t('settings:services.fields.enabled')} description={t('settings:services.enabledHint')} value={draft.enabled} onValueChange={(value) => setDraft({ ...draft, enabled: value })} palette={palette} />
          {!isRoot ? <SettingSwitchRow title={t('settings:services.fields.stripPrefix')} description={t('settings:services.stripPrefixHint')} value={draft.stripPrefix} onValueChange={(value) => setDraft({ ...draft, stripPrefix: value })} palette={palette} /> : null}
          <View style={styles.editorActions}>
            <Button testID="service-cancel" mode="text" disabled={Boolean(busyId)} onPress={cancelEdit}>{t('common:actions.cancel')}</Button>
            <Button testID="service-save" mode="contained" loading={Boolean(busyId)} disabled={Boolean(busyId)} onPress={() => void submitDraft()}>{t('common:actions.save')}</Button>
          </View>
        </View>
      ) : (
        <Button testID="service-add" mode="contained-tonal" icon="plus" disabled={atCapacity || api.isSaving || !api.available} onPress={startCreate}>
          {t('settings:services.add')}
        </Button>
      )}

      {atCapacity ? <HelperText type="info">{t('settings:services.capacity', { max: MAX_MANAGED_SERVICES })}</HelperText> : null}
      {api.services.length === 0
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
                <Button compact disabled={api.isSaving} onPress={() => startEdit(service)}>{t('common:actions.edit')}</Button>
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
  editor: { borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  service: { borderRadius: 14, borderWidth: 1, padding: 8 },
  serviceDescription: { gap: 2 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
