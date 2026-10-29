import { SettingButton as Button, SettingTextInput as TextInput, SettingSelectField, SettingSwitchRow, type Palette } from './sections/setting-rows';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText } from 'react-native-paper';


import {
  DEFAULT_SERVICES_PORT,
  getServicePortOptions,
  prepareServiceDraft,
  type ManagedService,
  type ServiceDraft,
  type ServiceDraftErrors,
  type ServicePortOption,
} from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';


function draftFor(service?: ManagedService): ServiceDraft {
  return service
    ? { id: service.id, name: service.name, port: service.port, path: service.path ?? '', target: service.target, enabled: service.enabled, access: service.access, stripPrefix: service.strip_prefix }
    : { id: '', name: '', port: undefined, path: '', target: '', enabled: false, access: 'private', stripPrefix: true };
}

// Full-screen add/edit form for one connector service. Presentation and local
// form state only: validation mirrors the connector through
// `prepareServiceDraft`, and every read/write goes through the provider's
// services domain. The route supplies the shell (app bar, keyboard avoidance).
export function ServiceEditor({ api, editing, palette, onDone }: {
  api: ServiceManagementApi;
  editing?: ManagedService;
  palette: Palette;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ServiceDraft>(() => draftFor(editing));
  const [errors, setErrors] = useState<ServiceDraftErrors>({});
  const [feedback, setFeedback] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  // Management revision 2 exposes dedicated ports and root services; older
  // (or pre-version) connectors stay on the legacy path-only surface.
  const version = api.version;
  const apiTwo = (version?.api ?? 0) >= 2;
  const servicePorts = version?.servicePorts?.length ? version.servicePorts : [DEFAULT_SERVICES_PORT];
  const isRoot = !draft.path.trim();
  const portOptions = apiTwo
    ? getServicePortOptions({ editingId: editing?.id, path: isRoot ? null : draft.path.trim(), servicePorts, services: api.services })
    : [];
  // A create starts on the first usable port, matching the connector's own
  // default, so Save never blocks on a port the user never had to choose.
  const selectedPort = draft.port ?? (apiTwo ? portOptions.find((option) => option.usable)?.port ?? servicePorts[0] : undefined);

  function portOptionLabel(option: ServicePortOption) {
    if (!option.usable) return `${option.port} (${t('settings:services.portOccupied')})`;
    if (option.shared) return `${option.port} (${t('settings:services.portShared')})`;
    return String(option.port);
  }

  function fieldError(field: keyof ServiceDraftErrors) {
    const code = errors[field];
    return code ? t(`settings:services.errors.${code}`) : undefined;
  }

  async function submitDraft() {
    const prepared = prepareServiceDraft({ ...draft, port: selectedPort }, {
      api: version?.api,
      servicePorts: version?.servicePorts,
      services: api.services,
    });
    setErrors(prepared.errors);
    if (!prepared.input) return;
    setIsSaving(true);
    setFeedback(undefined);
    try {
      await api.save(editing?.id ?? draft.id.trim(), prepared.input);
      onDone();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t('settings:services.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View testID="service-editor" style={styles.form}>
      {version && version.api < 2 ? (
        <HelperText testID="services-connector-hint" type="info">
          {version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}
        </HelperText>
      ) : null}
      <TextInput testID="service-id-input" mode="outlined" disabled={Boolean(editing)} label={t('settings:services.fields.id')} value={draft.id}
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
            valueLabel={selectedPort !== undefined ? String(selectedPort) : t('common:labels.none')}
            selectedValue={selectedPort !== undefined ? String(selectedPort) : undefined}
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
      {feedback ? <HelperText testID="service-editor-error" type="error">{feedback}</HelperText> : null}
      <View style={styles.actions}>
        <Button testID="service-cancel" mode="text" disabled={isSaving} onPress={onDone}>{t('common:actions.cancel')}</Button>
        <Button testID="service-save" mode="contained" loading={isSaving} disabled={isSaving || !api.available} onPress={() => void submitDraft()}>{t('common:actions.save')}</Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
});
