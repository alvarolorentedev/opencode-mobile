import { cn } from '@/shared/ui/cn';
import { useWatch, useForm, useController } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { serviceSchema } from '@/features/cloud-link/model/service-schema';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { FieldDescription } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { SettingSelectField, SettingSwitchRow, type Palette } from '@/shared/ui/settings/setting-rows';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DEFAULT_SERVICES_PORT, getServicePortOptions, prepareServiceDraft, type ManagedService, type ServiceDraft, type ServiceDraftErrors, type ServicePortOption } from '@/shared/contracts/service-management';
import type { ServiceManagementApi } from '@/shared/contracts/domain';

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
  const form = useForm<ServiceDraft>({ defaultValues: draftFor(editing), resolver: zodResolver(serviceSchema({ api: api.version?.api, servicePorts: api.version?.servicePorts, services: api.services })), mode: 'onSubmit', reValidateMode: 'onChange' });
  const draft = useWatch({ control: form.control, compute: (values) => values });
  const { field: { value: idValue, onChange: idChange, onBlur: idBlur, ref: idRef } } = useController({ control: form.control, name: 'id' });
  const { field: { value: nameValue, onChange: nameChange, onBlur: nameBlur, ref: nameRef } } = useController({ control: form.control, name: 'name' });
  const { field: { value: pathValue, onChange: pathChange, onBlur: pathBlur, ref: pathRef } } = useController({ control: form.control, name: 'path' });
  const { field: { value: targetValue, onChange: targetChange, onBlur: targetBlur, ref: targetRef } } = useController({ control: form.control, name: 'target' });
  const [feedback, setFeedback] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);

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
    const code = form.formState.errors[field]?.message;
    return code ? t(code) : undefined;
  }

  async function submitDraft() {
    if (submitting.current) return;
    submitting.current = true;
    try {
    form.setValue('port', selectedPort);
    if (!await form.trigger(undefined, { shouldFocus: true })) return;
    const prepared = prepareServiceDraft({ ...form.getValues(), port: selectedPort }, {
      api: version?.api,
      servicePorts: version?.servicePorts,
      services: api.services,
    });

    if (!prepared.input) return;
    setIsSaving(true);
    setFeedback(undefined);
      await api.save(editing?.id ?? draft.id.trim(), prepared.input);
      onDone();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t('settings:services.saveFailed'));
    } finally {
      submitting.current = false;
      setIsSaving(false);
    }
  }

  return (
    <View testID="service-editor" className={cn(stylesClasses.form)}>
      {version && version.api < 2 ? (
        <FieldDescription testID="services-connector-hint" invalid={false}>{version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}</FieldDescription>
      ) : null}
      <SettingField testID="service-id-input" invalid={Boolean(fieldError('id'))} aria-describedby={fieldError('id') ? 'service-id-error' : undefined} disabled={Boolean(editing)} label={t('settings:services.fields.id')} ref={idRef} onBlur={idBlur} value={idValue} onChangeText={idChange} autoCapitalize="none" autoCorrect={false}></SettingField>
      {fieldError('id') ? <FieldDescription nativeID="service-id-error" invalid={true}>{fieldError('id')}</FieldDescription> : null}
      <SettingField testID="service-name-input" invalid={Boolean(fieldError('name'))} aria-describedby={fieldError('name') ? 'service-name-error' : undefined} label={t('settings:services.fields.name')} ref={nameRef} onBlur={nameBlur} value={nameValue} onChangeText={nameChange}></SettingField>
      {fieldError('name') ? <FieldDescription nativeID="service-name-error" invalid={true}>{fieldError('name')}</FieldDescription> : null}
      {apiTwo ? (
        <>
          <SettingSelectField
            testID="service-port-select"
            label={t('settings:services.fields.port')}
            valueLabel={selectedPort !== undefined ? String(selectedPort) : t('common:labels.none')}
            selectedValue={selectedPort !== undefined ? String(selectedPort) : undefined}
            onValueChange={(value) => form.setValue('port', Number(value), { shouldDirty: true })}
            options={portOptions.map((option) => ({ value: String(option.port), label: portOptionLabel(option) }))}
            palette={palette}
          />
          {fieldError('port') ? <FieldDescription  invalid={true}>{fieldError('port')}</FieldDescription> : null}
        </>
      ) : null}
      <SettingField testID="service-path-input" invalid={Boolean(fieldError('path'))} aria-describedby={fieldError('path') ? 'service-path-error' : undefined} label={t('settings:services.fields.path')} placeholder="/test/api" ref={pathRef} onBlur={pathBlur} value={pathValue} onChangeText={pathChange} autoCapitalize="none" autoCorrect={false}></SettingField>
      {fieldError('path') ? <FieldDescription nativeID="service-path-error" invalid={true}>{fieldError('path')}</FieldDescription>
        : isRoot && apiTwo ? <FieldDescription  invalid={false}>{t('settings:services.rootPathHint')}</FieldDescription> : null}
      <SettingField testID="service-target-input" invalid={Boolean(fieldError('target'))} aria-describedby={fieldError('target') ? 'service-target-error' : undefined} label={t('settings:services.fields.target')} placeholder="127.0.0.1:3000" ref={targetRef} onBlur={targetBlur} value={targetValue} onChangeText={targetChange} autoCapitalize="none" autoCorrect={false}></SettingField>
      {fieldError('target') ? <FieldDescription nativeID="service-target-error" invalid={true}>{fieldError('target')}</FieldDescription> : null}
      <SettingSelectField
        label={t('settings:services.fields.access')}
        valueLabel={t(`settings:services.access.${draft.access}`)}
        selectedValue={draft.access}
        onValueChange={(value) => form.setValue('access', value, { shouldDirty: true })}
        options={[{ value: 'private', label: t('settings:services.access.private') }, { value: 'public', label: t('settings:services.access.public') }]}
        palette={palette}
      />
      <SettingSwitchRow title={t('settings:services.fields.enabled')} description={t('settings:services.enabledHint')} value={draft.enabled} onValueChange={(value) => form.setValue('enabled', value, { shouldDirty: true })} palette={palette} />
      {!isRoot ? <SettingSwitchRow title={t('settings:services.fields.stripPrefix')} description={t('settings:services.stripPrefixHint')} value={draft.stripPrefix} onValueChange={(value) => form.setValue('stripPrefix', value, { shouldDirty: true })} palette={palette} /> : null}
      {feedback ? <FieldDescription testID="service-editor-error" invalid={true}>{feedback}</FieldDescription> : null}
      <View className={cn(stylesClasses.actions)}>
        <Button testID="service-cancel" disabled={isSaving} onPress={onDone} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
        <Button testID="service-save" disabled={isSaving || !api.available} onPress={() => void submitDraft()} variant="default">{isSaving ? <Spinner size="small" /> : null}<Text>{t('common:actions.save')}</Text></Button>
      </View>
    </View>
  );
}

const stylesClasses = {
  "form": "gap-1",
  "actions": "flex-row justify-end gap-2 mt-3"
} as const;
