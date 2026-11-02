import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { pluginSchema } from '@/features/extensions/model/extension-schemas';
import { ExtensionEditor, type EditorProps } from '@/features/extensions/ui/extension-editor';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { FieldDescription } from '@/shared/ui/text-field';

export function PluginEditor({ context, scope, onClose, save }: EditorProps & { context: string }) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const form = useForm({ resolver: zodResolver(pluginSchema), defaultValues: { target: '' }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const writable = Boolean(extensions.snapshot?.[scope].safety.writable);
  function submit() { void form.handleSubmit((draft) => save(async () => { await extensions.addPlugin(scope, draft.target.trim()); onClose(); }))(); }
  return <ExtensionEditor title={t('settings:extensions.plugins.addTitle')} context={context} dirty={form.formState.isDirty} busy={Boolean(extensions.busy)} readOnly={!writable} error={extensions.error} onClose={onClose} onSubmit={submit} saveID="settings-extension-plugin-add"
    setup={<View className="gap-3">
      {!writable ? <FieldDescription>{extensions.snapshot?.[scope].safety.reason || t('settings:extensions.safety.readOnly')}</FieldDescription> : null}
      <Controller control={form.control} name="target" render={({ field, fieldState }) => <View className="gap-1">
        <SettingField testID="settings-extension-plugin-target" label={t('settings:extensions.plugins.package')} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} disabled={Boolean(extensions.busy) || !writable} invalid={Boolean(fieldState.error)} autoCapitalize="none" autoCorrect={false} placeholder="@scope/plugin@1.0.0" />
        {fieldState.error ? <FieldDescription invalid>{t(fieldState.error.message || 'common:validation.required')}</FieldDescription> : null}
      </View>} />
      <FieldDescription>{t('settings:extensions.editor.pluginHint')}</FieldDescription>
      <FieldDescription>{t('settings:extensions.plugins.warning')}</FieldDescription>
    </View>} />;
}
