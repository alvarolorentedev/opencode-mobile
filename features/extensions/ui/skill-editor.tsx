import { View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSkillEditor } from '@/features/extensions/state/use-skill-editor';
import { ExtensionEditor, type EditorProps } from '@/features/extensions/ui/extension-editor';
import type { ExtensionSkillRow } from '@/shared/protocol/opencode/extensions/types';
import { slugifySkillId } from '@/shared/contracts/skill-id';
import { SettingField, SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { SettingsDisclosure, useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function SkillEditor({ row, context, scope, onClose, save }: EditorProps & { row?: ExtensionSkillRow; context: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const target = useSettingsTarget();
  const { form, values, writable, busy, disabled, sourceMode, source, setSource, section, setSection, error, submit, changeSourceMode } = useSkillEditor({ row, scope, onClose, save,
    initialSection: target?.label === t('settings:extensions.skills.instructions') ? 'instructions' : 'setup' });
  const field = (name: 'id' | 'name' | 'description' | 'instructions', label: string) => <Controller key={name} control={form.control} name={name} render={({ field: input, fieldState }) => <View className="gap-1">
    <SettingField testID={`settings-extension-skill-${name}`} label={label} value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} ref={input.ref}
      disabled={disabled || (name === 'id' && Boolean(row))} invalid={Boolean(fieldState.error)} multiline={name === 'instructions'} numberOfLines={12}
      placeholder={name === 'id' ? slugifySkillId(values.name) || 'my-skill' : undefined} autoCapitalize={name === 'id' ? 'none' : 'sentences'} autoCorrect={name !== 'id'} />
    {fieldState.error ? <FieldDescription invalid>{t(fieldState.error.message || 'common:validation.invalid')}</FieldDescription> : null}
  </View>} />;
  return <ExtensionEditor title={row ? t('settings:extensions.skills.editTitle', { name: row.name }) : t('settings:extensions.skills.addTitle')} context={context}
    dirty={form.formState.isDirty || source !== (row?.content ?? '')} busy={busy} readOnly={!writable} error={error} onClose={onClose} onSubmit={submit}
    section={section} onSectionChange={setSection} saveID="settings-extension-skill-add"
    setup={<View className="gap-3">{sourceMode ? <FieldDescription>{t('settings:extensions.editor.sourceHint')}</FieldDescription> : <>
      {field('name', t('settings:extensions.skills.name'))}{field('id', t('settings:extensions.skills.id'))}{field('description', t('settings:extensions.skills.descriptionLabel'))}
      <SettingSwitchRow palette={palette} disabled={disabled} title={t('settings:extensions.editor.autoinvoke')} description={t('settings:extensions.editor.autoinvokeHint')} value={values.autoinvoke} onValueChange={(value) => form.setValue('autoinvoke', value, { shouldDirty: true })} />
    </>}{row ? <SettingsDisclosure id="extension-skill-source" title={t('settings:extensions.editor.advanced')}><Button variant="outline" onPress={changeSourceMode}><Text>{t(sourceMode ? 'settings:extensions.editor.useFields' : 'settings:extensions.editor.editSource')}</Text></Button></SettingsDisclosure> : null}</View>}
    instructions={sourceMode ? <SettingField testID="settings-extension-skill-source" label={t('settings:extensions.skills.fileContent')} value={source} onChangeText={setSource} disabled={disabled} multiline numberOfLines={18} autoCapitalize="none" autoCorrect={false} /> : <View>{field('instructions', t('settings:extensions.skills.instructions'))}</View>} />;
}
