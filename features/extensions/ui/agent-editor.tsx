import { Pressable, View } from 'react-native';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ModelPicker } from '@/features/ai/index';
import { useAgentEditor } from '@/features/extensions/state/use-agent-editor';
import { ExtensionEditor, type EditorProps } from '@/features/extensions/ui/extension-editor';
import { DefinitionFormat } from '@/features/extensions/ui/definition-format';
import { PermissionFields } from '@/features/extensions/ui/permission-fields';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { SettingsDisclosure, SettingTarget, useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { Text } from '@/shared/ui/text';
import { Icon } from '@/shared/ui/icon';
import { FieldDescription } from '@/shared/ui/text-field';
import type { ExtensionAgentRow } from '@/shared/protocol/opencode/extensions/types';

export function AgentEditor({ row, readOnly = false, context, scope, onClose, save }: EditorProps & { row?: ExtensionAgentRow; readOnly?: boolean; context: string }) {
  const { t } = useTranslation();
  const target = useSettingsTarget();
  const { setFormat, form, values, busy, disabled, models, selected, modelParts, complexModel, rules, setRules, setModel, section, setSection, advancedError, permissionsOpen, submit, error } = useAgentEditor({ row, readOnly, scope, onClose, save,
    initialSection: target?.label === t('settings:extensions.agents.instructions') ? 'instructions' : 'setup', initialPermissionsOpen: target?.label === t('settings:extensions.agents.permissions') });
  const field = (name: 'id' | 'description' | 'model' | 'instructions' | 'permissions' | 'advancedFrontmatter', label: string, multiline = false) => <Controller key={name} control={form.control} name={name} render={({ field: input, fieldState }) => <View className="gap-1">
    <SettingField testID={`settings-extension-agent-${name === 'advancedFrontmatter' ? 'advanced' : name}`} label={label} value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} ref={input.ref}
      invalid={Boolean(fieldState.error)} disabled={disabled} multiline={multiline} numberOfLines={name === 'instructions' ? 10 : 4} autoCapitalize={['id', 'model', 'permissions', 'advancedFrontmatter'].includes(name) ? 'none' : 'sentences'} autoCorrect={!['id', 'model', 'permissions', 'advancedFrontmatter'].includes(name)} />
    {fieldState.error ? <FieldDescription invalid>{t(fieldState.error.message || 'common:validation.invalid')}</FieldDescription> : null}
  </View>} />;
  return <ExtensionEditor title={readOnly && row ? row.name : row ? t('settings:extensions.agents.editTitle', { name: row.name }) : t('settings:extensions.agents.addTitle')} context={context}
    dirty={form.formState.isDirty} busy={busy} error={error} onClose={onClose} onSubmit={submit} readOnly={readOnly}
    section={section} onSectionChange={setSection} saveID="settings-extension-agent-save"
    instructions={<View className="gap-3">{field('instructions', t('settings:extensions.agents.instructions'), true)}</View>}
    setup={<View className="gap-4">
      {readOnly ? <FieldDescription>{row?.readOnlyReason || t('settings:extensions.sharedHint')}</FieldDescription> : null}
      {field('id', t('settings:extensions.agents.id'))}
      {field('description', t('settings:extensions.agents.descriptionLabel'))}
      <SettingTarget label={t('settings:extensions.editor.availability')}><Text variant="description">{t('settings:extensions.editor.availability')}</Text>
      <View accessibilityRole="radiogroup" className="rounded-group border border-border overflow-hidden">
        {(['primary', 'subagent', 'all'] as const).map((mode) => <Pressable key={mode} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: values.mode === mode, disabled }}
          onPress={() => form.setValue('mode', mode, { shouldDirty: true })} className="min-h-row flex-row items-center gap-3 border-b border-border p-3">
          <Icon name={values.mode === mode ? 'radiobox-marked' : 'radiobox-blank'} className="text-primary" />
          <View className="flex-1 gap-1"><Text>{t(`settings:extensions.editor.mode.${mode}`)}</Text><Text variant="description" className="text-muted-foreground">{t(`settings:extensions.editor.modeHint.${mode}`)}</Text></View>
        </Pressable>)}
      </View></SettingTarget>
      <SettingTarget label={t('settings:extensions.agents.model')}><View className="gap-2">
        <Text variant="label">{t('settings:extensions.agents.model')}</Text>
        <ModelPicker models={models} disabled={disabled || complexModel} testID="extension-agent-model-picker" selectedModelId={selected?.id}
          fallbackLabel={complexModel ? t('settings:extensions.editor.customModel') : values.model || undefined}
          inheritChoice={{ label: t('settings:extensions.editor.inheritModel'), description: t('settings:extensions.editor.inheritModelHint'), selected: !values.model && !complexModel, onSelect: () => setModel('') }}
          onSelect={(model) => setModel(`${model.providerID}/${model.modelID}`)} selectedVariant={modelParts[1]}
          onVariantChange={selected ? (variant) => setModel(`${selected.providerID}/${selected.modelID}${variant ? `#${variant}` : ''}`) : undefined} />
        {!models.length || complexModel ? <FieldDescription>{t(complexModel ? 'settings:extensions.editor.customModelHint' : 'settings:extensions.editor.noModels')}</FieldDescription> : null}
      </View></SettingTarget>
      <SettingsDisclosure id="extension-agent-permissions" title={`${t('settings:extensions.agents.permissions')} · ${t(values.permissions.trim() ? 'settings:extensions.editor.custom' : 'settings:extensions.editor.inherited')}`} attention={permissionsOpen}>
        <SettingTarget label={t('settings:extensions.agents.permissions')}>
          {form.formState.errors.permissions ? <FieldDescription invalid>{t(form.formState.errors.permissions.message || 'common:validation.invalid')}</FieldDescription> : null}
          {rules ? <PermissionFields rules={rules} disabled={disabled} onChange={setRules} /> : <>
            <FieldDescription>{t('settings:extensions.editor.legacyRules')}</FieldDescription>{field('permissions', t('settings:extensions.agents.permissions'), true)}
          </>}
        </SettingTarget>
      </SettingsDisclosure>
      <SettingsDisclosure id="extension-agent-advanced" title={t('settings:extensions.editor.advanced')} attention={advancedError || target?.label === t('settings:extensions.agents.advanced') || target?.label === t('settings:extensions.editor.customModel')}>
        {field('model', t('settings:extensions.editor.customModel'))}
        {values.format === 'markdown' ? field('advancedFrontmatter', t('settings:extensions.agents.advanced'), true) : null}
        {rules ? field('permissions', t('settings:extensions.editor.source'), true) : null}
        {!row ? <DefinitionFormat value={values.format} onChange={setFormat} /> : null}
        <FieldDescription>{t(values.format === 'markdown' ? 'settings:extensions.agents.markdownHint' : 'settings:extensions.agents.jsoncHint')}</FieldDescription>
      </SettingsDisclosure>
    </View>} />;
}
