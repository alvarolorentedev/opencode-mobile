import { View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { commandSchema, type CommandDraft } from '@/features/extensions/model/extension-schemas';
import { ExtensionEditor, useEditorSection, type EditorProps } from '@/features/extensions/ui/extension-editor';
import { DefinitionFormat } from '@/features/extensions/ui/definition-format';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { SettingsDisclosure } from '@/shared/ui/settings/settings-panel';
import { FieldDescription } from '@/shared/ui/text-field';
import type { ExtensionCommandRow } from '@/shared/protocol/opencode/extensions/types';

export function CommandEditor({ row, context, scope, onClose, save }: EditorProps & { row?: ExtensionCommandRow; context: string }) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const [section, setSection] = useEditorSection(t('settings:extensions.commands.template'));
  const form = useForm<CommandDraft>({ resolver: zodResolver(commandSchema), defaultValues: { name: row?.name ?? '', description: row?.description ?? '', template: row?.template ?? '', format: row?.origin === 'config' ? 'jsonc' : 'markdown' }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const writable = row ? row.editable : Boolean(extensions.snapshot?.[scope].markdown.commands.safety.writable);
  const busy = Boolean(extensions.busy);
  const format = useWatch({ control: form.control, name: 'format' });
  function submit() { void form.handleSubmit((draft) => save(async () => { await extensions.saveCommand(scope, draft, row); onClose(); }), (errors) => setSection(errors.template ? 'instructions' : 'setup'))(); }
  const field = (name: 'name' | 'description' | 'template', label: string) => <Controller key={name} control={form.control} name={name} render={({ field: input, fieldState }) => <View className="gap-1">
    <SettingField testID={`settings-extension-command-${name}`} label={label} value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} ref={input.ref}
      disabled={busy || !writable} invalid={Boolean(fieldState.error)} multiline={name === 'template'} numberOfLines={12} autoCapitalize={name === 'name' ? 'none' : 'sentences'} autoCorrect={name !== 'name'} />
    {fieldState.error ? <FieldDescription invalid>{t(fieldState.error.message || 'common:validation.invalid')}</FieldDescription> : null}
  </View>} />;
  return <ExtensionEditor title={row ? t('settings:extensions.commands.editTitle', { name: row.name }) : t('settings:extensions.commands.addTitle')} context={context}
    dirty={form.formState.isDirty} busy={busy} readOnly={!writable} error={extensions.error} onClose={onClose} onSubmit={submit} section={section} onSectionChange={setSection} saveID="settings-extension-command-save"
    setup={<View className="gap-3">{field('name', t('settings:extensions.commands.name'))}{field('description', t('settings:extensions.commands.descriptionLabel'))}
      <SettingsDisclosure id="extension-command-format" title={t('settings:extensions.editor.advanced')}>
        {!row ? <DefinitionFormat value={format} onChange={(value) => form.setValue('format', value, { shouldDirty: true })} /> : null}
        <FieldDescription>{t(format === 'markdown' ? 'settings:extensions.commands.markdownHint' : 'settings:extensions.commands.jsoncHint')}</FieldDescription>
      </SettingsDisclosure></View>}
    instructions={<View className="gap-3">{field('template', t('settings:extensions.commands.template'))}<FieldDescription>{t('settings:extensions.commands.templateHint')}</FieldDescription></View>} />;
}
