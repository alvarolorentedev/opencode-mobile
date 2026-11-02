import { View } from 'react-native';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { mcpEditorSchema, type McpEditorDraft } from '@/features/extensions/model/extension-schemas';
import { ExtensionEditor, type EditorProps } from '@/features/extensions/ui/extension-editor';
import { SettingField, SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { ExtensionMcpRow } from '@/shared/protocol/opencode/extensions/types';

export function McpEditor({ row, remote = false, context, scope, onClose, save }: EditorProps & { row?: ExtensionMcpRow; remote?: boolean; context: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { extensions } = useExtensions();
  const command = row?.config && 'command' in row.config && Array.isArray(row.config.command) ? row.config.command : [];
  const form = useForm<McpEditorDraft>({ resolver: zodResolver(mcpEditorSchema), defaultValues: {
    name: row?.name ?? '', type: row?.config?.type === 'remote' || remote ? 'remote' : 'local', url: row?.config && 'url' in row.config && typeof row.config.url === 'string' ? row.config.url : '',
    executable: String(command[0] ?? ''), arguments: command.slice(1).map((value: unknown) => ({ value: String(value) })),
  }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'arguments' });
  const type = useWatch({ control: form.control, name: 'type' });
  const busy = Boolean(extensions.busy);
  const writable = row ? row.editable : Boolean(extensions.snapshot?.[scope].safety.writable);
  function submit() { void form.handleSubmit((draft) => save(async () => {
    const config = draft.type === 'remote' ? { type: 'remote' as const, url: draft.url.trim() } : { type: 'local' as const, command: [draft.executable.trim(), ...draft.arguments.map((arg) => arg.value)] };
    if (row) await extensions.updateMcp(scope, row.name, config);
    else await extensions.addMcp(scope, draft.name.trim(), config);
    onClose();
  }))(); }
  const field = (name: 'name' | 'url' | 'executable', label: string, placeholder?: string) => <Controller key={name} control={form.control} name={name} render={({ field: input, fieldState }) => <View className="gap-1">
    <SettingField testID={`settings-extension-mcp-${name === 'url' ? 'target' : name}`} label={label} value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} ref={input.ref} placeholder={placeholder}
      disabled={busy || !writable || (name === 'name' && Boolean(row))} invalid={Boolean(fieldState.error)} autoCapitalize="none" autoCorrect={false} />
    {fieldState.error ? <FieldDescription invalid>{t(fieldState.error.message || 'common:validation.invalid')}</FieldDescription> : null}
  </View>} />;
  return <ExtensionEditor title={row ? row.name : t('settings:extensions.mcp.addTitle')} context={context} dirty={form.formState.isDirty} busy={busy} readOnly={!writable} error={extensions.error} onClose={onClose} onSubmit={submit} saveID="settings-extension-mcp-add"
    setup={<View className="gap-3">
      {!writable ? <FieldDescription>{extensions.snapshot?.[scope].safety.reason || t('settings:extensions.safety.readOnly')}</FieldDescription> : null}
      {field('name', t('settings:mcp.serverName'))}
      <SettingSelectField label={t('settings:extensions.editor.connectionType')} palette={palette} disabled={busy || !writable || Boolean(row)} selectedValue={type} valueLabel={t(`settings:extensions.editor.mcpType.${type}`)}
        options={(['remote', 'local'] as const).map((value) => ({ value, label: t(`settings:extensions.editor.mcpType.${value}`) }))} onValueChange={(value) => form.setValue('type', value, { shouldDirty: true })} />
      {type === 'remote' ? field('url', t('settings:mcp.url'), 'https://example.com/mcp') : <>
        {field('executable', t('settings:extensions.editor.executable'), 'npx')}
        <FieldDescription>{t('settings:extensions.editor.argumentsHint')}</FieldDescription>
        {fields.map((arg, index) => <View key={arg.id} className="flex-row items-end gap-2"><View className="flex-1"><Controller control={form.control} name={`arguments.${index}.value`} render={({ field: input }) => <SettingField
          label={t('settings:extensions.editor.argument', { number: index + 1 })} value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} ref={input.ref} disabled={busy || !writable} autoCapitalize="none" autoCorrect={false} />} /></View>
          <Button variant="ghost" disabled={busy || !writable} accessibilityLabel={t('settings:extensions.editor.removeArgument', { number: index + 1 })} onPress={() => remove(index)}><Text>{t('common:actions.remove')}</Text></Button></View>)}
        <Button variant="outline" disabled={busy || !writable} onPress={() => append({ value: '' })}><Text>{t('settings:extensions.editor.addArgument')}</Text></Button>
      </>}
    </View>} />;
}
