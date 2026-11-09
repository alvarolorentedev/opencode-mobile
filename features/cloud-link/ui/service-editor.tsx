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
import { formatTimestamp } from '@/shared/presentation/format';

import {
  DEFAULT_SERVICES_PORT,
  getServicePortOptions,
  prepareServiceDraft,
  serviceDraftFor,
  type ManagedService,
  type ServiceDraft,
  type ServiceDraftErrors,
  type ServiceDraftContext,
  type ServicePortOption,
} from '@/shared/contracts/service-management';
import {
  SERVICE_ACCESS_CONNECTOR_VERSION,
  getServiceServerNow,
  resolveServiceExpiration,
  supportsServiceAccess,
  type ServiceAccessMode,
  type ServiceExpirationChoice,
  type ServiceExpirationUnit,
} from '@/shared/contracts/service-access';
import type { ServiceManagementApi } from '@/shared/contracts/domain';

// Full-screen add/edit form for one connector service. Presentation and local
// form state only: validation mirrors the connector through
// `prepareServiceDraft`, and every read/write goes through the provider's
// services domain. The route supplies the shell (app bar, keyboard avoidance).
//
// Access controls only render when the connector advertises
// `service-access-v1`; without it the form keeps the legacy private/public
// surface and never sends a policy.
export function ServiceEditor({ api, editing, palette, onDone }: {
  api: ServiceManagementApi;
  editing?: ManagedService;
  palette: Palette;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const version = api.version;
  const accessSupported = supportsServiceAccess(version);
  const apiTwo = (version?.api ?? 0) >= 2;
  const servicePorts = version?.servicePorts?.length ? version.servicePorts : [DEFAULT_SERVICES_PORT];
  const serverNow = () => getServiceServerNow(api.serverTime, api.serverTimeAt);
  const draftContext = (): ServiceDraftContext => ({
    api: version?.api,
    servicePorts: version?.servicePorts,
    services: api.services,
    accessSupported,
    serverTime: serverNow(),
  });
  const form = useForm<ServiceDraft>({
    defaultValues: serviceDraftFor(editing, serverNow()),
    resolver: zodResolver(serviceSchema()),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const draft = useWatch({ control: form.control, compute: (values) => values });
  const { field: { value: idValue, onChange: idChange, onBlur: idBlur, ref: idRef } } = useController({ control: form.control, name: 'id' });
  const { field: { value: nameValue, onChange: nameChange, onBlur: nameBlur, ref: nameRef } } = useController({ control: form.control, name: 'name' });
  const { field: { value: pathValue, onChange: pathChange, onBlur: pathBlur, ref: pathRef } } = useController({ control: form.control, name: 'path' });
  const { field: { value: targetValue, onChange: targetChange, onBlur: targetBlur, ref: targetRef } } = useController({ control: form.control, name: 'target' });
  const [feedback, setFeedback] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);

  const isRoot = !draft.path.trim();
  const portOptions = apiTwo
    ? getServicePortOptions({ editingId: editing?.id, path: isRoot ? null : draft.path.trim(), servicePorts, services: api.services })
    : [];
  // A create starts on the first usable port, matching the connector's own
  // default, so Save never blocks on a port the user never had to choose.
  const selectedPort = draft.port ?? (apiTwo ? portOptions.find((option) => option.usable)?.port ?? servicePorts[0] : undefined);
  const showAccessControls = accessSupported;
  const showExpiration = accessSupported && draft.accessMode !== 'private';
  const showPassword = accessSupported && draft.accessMode === 'password';
  const expiredShare = draft.expiration === 'expired';
  // A stored policy always needs one re-sent; a legacy service only gains one
  // when the user picks password or a real deadline; a new external service
  // shares for an hour by default.
  const policyRequired = accessSupported
    && (draft.hasPolicy || (draft.accessMode !== 'private' && (!draft.legacy || draft.expiration !== 'none')));
  const resolvedExpiration = showExpiration && !expiredShare
    ? resolveServiceExpiration({
      choice: draft.expiration,
      currentExpiresAt: draft.currentExpiresAt,
      serverTime: serverNow(),
      amount: draft.customExpirationAmount,
      unit: draft.customExpirationUnit,
    })
    : undefined;
  const previewExpiresAt = resolvedExpiration && !('error' in resolvedExpiration) ? resolvedExpiration.expiresAt : undefined;

  const accessOptions: { value: ServiceAccessMode; label: string }[] = showAccessControls
    ? [
      { value: 'private', label: t('settings:services.access.private') },
      { value: 'public', label: t('settings:services.access.public') },
      { value: 'password', label: t('settings:services.access.password') },
    ]
    : [
      { value: 'private', label: t('settings:services.access.private') },
      { value: 'public', label: t('settings:services.access.public') },
    ];

  const expirationOptions: { value: ServiceExpirationChoice; label: string }[] = [];
  if (draft.hasPolicy && draft.currentExpiresAt !== null && !expiredShare) {
    expirationOptions.push({
      value: 'keep',
      label: t('settings:services.expiration.keep', { date: formatTimestamp(draft.currentExpiresAt * 1000, i18n.language) }),
    });
  }
  expirationOptions.push(
    { value: 'none', label: t('settings:services.expiration.none') },
    { value: '15m', label: t('settings:services.expiration.fifteenMinutes') },
    { value: '1h', label: t('settings:services.expiration.oneHour') },
    { value: '24h', label: t('settings:services.expiration.twentyFourHours') },
    { value: 'custom', label: t('settings:services.expiration.custom') },
  );

  const unitOptions: { value: ServiceExpirationUnit; label: string }[] = [
    { value: 'minutes', label: t('settings:services.units.minutes') },
    { value: 'hours', label: t('settings:services.units.hours') },
    { value: 'days', label: t('settings:services.units.days') },
  ];

  function portOptionLabel(option: ServicePortOption) {
    if (!option.usable) return `${option.port} (${t('settings:services.portOccupied')})`;
    if (option.shared) return `${option.port} (${t('settings:services.portShared')})`;
    return String(option.port);
  }

  function expirationValueLabel() {
    if (draft.expiration === 'expired') return t('settings:services.expiration.choose');
    return expirationOptions.find((option) => option.value === draft.expiration)?.label ?? t('settings:services.expiration.none');
  }

  // Changing mode away from password clears the typed value; picking password
  // on a service that has never had one defaults to the one-hour share.
  function changeAccessMode(value: ServiceAccessMode) {
    form.setValue('accessMode', value, { shouldDirty: true });
    form.setValue('password', '', { shouldDirty: true });
    if (value === 'password' && !draft.hasPolicy && draft.expiration === 'none') {
      form.setValue('expiration', '1h', { shouldDirty: true });
    }
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
      form.clearErrors();
      if (!await form.trigger(undefined, { shouldFocus: true })) return;
      // The connector mirror runs here with this render's context, so a version
      // answer that lands after the form mounted is always used.
      const prepared = prepareServiceDraft({ ...form.getValues(), port: selectedPort }, draftContext());
      if (!prepared.input) {
        const failures = Object.entries(prepared.errors).filter(([, error]) => error) as [keyof ServiceDraftErrors, string][];
        failures.forEach(([field, error]) => form.setError(field, { type: 'manual', message: `settings:services.errors.${error}` }));
        return;
      }
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

  const blocked = isSaving || !api.available || (!accessSupported && draft.hasPolicy);

  return (
    <View testID="service-editor" className={cn(stylesClasses.form)}>
      {version && version.api < 2 ? (
        <FieldDescription testID="services-connector-hint" invalid={false}>{version.known ? t('settings:services.legacyConnector') : t('settings:services.unknownConnector')}</FieldDescription>
      ) : null}
      {!accessSupported && (version || draft.hasPolicy) ? (
        <FieldDescription testID="services-access-hint" invalid={false}>{t('settings:services.expiration.updateConnector', { version: SERVICE_ACCESS_CONNECTOR_VERSION })}</FieldDescription>
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
        testID="service-access-select"
        label={t('settings:services.fields.access')}
        valueLabel={t(`settings:services.access.${draft.accessMode}`)}
        selectedValue={draft.accessMode}
        onValueChange={changeAccessMode}
        options={accessOptions}
        disabled={!accessSupported && draft.hasPolicy}
        palette={palette}
      />
      {fieldError('accessMode') ? <FieldDescription testID="service-access-error" invalid={true}>{fieldError('accessMode')}</FieldDescription> : null}
      {accessSupported && draft.hasPolicy && draft.accessMode === 'private' ? (
        <FieldDescription testID="service-private-hint" invalid={false}>{t('settings:services.expiration.privateWarning')}</FieldDescription>
      ) : null}
      {accessSupported && draft.legacy && policyRequired && draft.accessMode !== 'private' ? (
        <FieldDescription testID="service-legacy-warning" invalid={false}>{t('settings:services.expiration.legacyWarning')}</FieldDescription>
      ) : null}
      {showExpiration ? (
        <>
          <SettingSelectField
            testID="service-expiration-select"
            label={t('settings:services.fields.expiration')}
            valueLabel={expirationValueLabel()}
            selectedValue={draft.expiration}
            onValueChange={(value) => form.setValue('expiration', value, { shouldDirty: true })}
            options={expirationOptions}
            palette={palette}
          />
          {draft.expiration === 'custom' ? (
            <>
              <SettingField
                testID="service-custom-expiration-amount"
                label={t('settings:services.fields.customExpiration')}
                keyboardType="numeric"
                inputMode="numeric"
                value={draft.customExpirationAmount}
                onChangeText={(value) => form.setValue('customExpirationAmount', value, { shouldDirty: true })}
              />
              <SettingSelectField
                testID="service-custom-expiration-unit"
                label={t('settings:services.units.label')}
                valueLabel={t(`settings:services.units.${draft.customExpirationUnit}`)}
                selectedValue={draft.customExpirationUnit}
                onValueChange={(value) => form.setValue('customExpirationUnit', value, { shouldDirty: true })}
                options={unitOptions}
                palette={palette}
              />
            </>
          ) : null}
          {previewExpiresAt ? (
            <FieldDescription testID="service-expiration-preview" invalid={false}>{t('settings:services.expiration.expiresAt', { date: formatTimestamp(previewExpiresAt * 1000, i18n.language) })}</FieldDescription>
          ) : null}
          {expiredShare ? <FieldDescription testID="service-expired-hint" invalid={false}>{t('settings:services.expiration.expiredHint')}</FieldDescription> : null}
          {fieldError('expiration') ? <FieldDescription nativeID="service-expiration-error" invalid={true}>{fieldError('expiration')}</FieldDescription> : null}
        </>
      ) : null}
      {showPassword ? (
        <>
          <SettingField
            testID="service-password-input"
            label={t('settings:services.fields.password')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            value={draft.password}
            onChangeText={(value) => form.setValue('password', value, { shouldDirty: true })}
          />
          <FieldDescription testID="service-password-guidance" invalid={false}>{draft.passwordSet ? t('settings:services.expiration.passwordSet') : t('settings:services.expiration.passwordHint')}</FieldDescription>
          {fieldError('password') ? <FieldDescription nativeID="service-password-error" invalid={true}>{fieldError('password')}</FieldDescription> : null}
        </>
      ) : null}
      <SettingSwitchRow title={t('settings:services.fields.enabled')} description={t('settings:services.enabledHint')} value={draft.enabled} onValueChange={(value) => form.setValue('enabled', value, { shouldDirty: true })} palette={palette} />
      {!isRoot ? <SettingSwitchRow title={t('settings:services.fields.stripPrefix')} description={t('settings:services.stripPrefixHint')} value={draft.stripPrefix} onValueChange={(value) => form.setValue('stripPrefix', value, { shouldDirty: true })} palette={palette} /> : null}
      {feedback ? <FieldDescription testID="service-editor-error" invalid={true}>{feedback}</FieldDescription> : null}
      <View className={cn(stylesClasses.actions)}>
        <Button testID="service-cancel" disabled={isSaving} onPress={onDone} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
        <Button testID="service-save" disabled={blocked} onPress={() => void submitDraft()} variant="default">{isSaving ? <Spinner size="small" /> : null}<Text>{t('common:actions.save')}</Text></Button>
      </View>
    </View>
  );
}

const stylesClasses = {
  "form": "gap-1",
  "actions": "flex-row justify-end gap-2 mt-3"
} as const;
