import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs';
import { cn } from '@/shared/ui/cn';
import { useForm, useController } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { mcpSchema, skillSchema, commandSchema, type McpDraft, type SkillDraft, type CommandDraft } from '@/features/extensions/model/extension-schemas';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';
import { Spinner } from '@/shared/ui/spinner';
import { ListRow } from '@/shared/ui/list-row';
import { Badge } from '@/shared/ui/badge';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMcpAuthentication } from '@/features/extensions/ui/use-mcp-authentication';
import { SettingTarget, useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { getErrorMessage } from '@/shared/utilities/error-message';
import { slugifySkillId } from '@/shared/contracts/skill-id';
import { visibleSharedRows } from '@/shared/presentation/extension-rows';
import type { ExtensionScope, ExtensionSkillRow, ExtensionSnapshot } from '@/shared/protocol/opencode/extensions/types';
import { useExtensions, useMcp } from '@/features/extensions/context';
import { useProjects } from '@/features/projects/context';

type Tab = 'mcp' | 'plugins' | 'skills' | 'commands';

function SafetyCard({ data, scope, onRestore, busy }: { data: ExtensionSnapshot[ExtensionScope]; scope: ExtensionScope; onRestore: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return (
    <View className={cn(stylesClasses.card, "bg-surface-alt border-border")}>
      <Text className={cn("text-foreground")} variant="description">{t(`settings:extensions.scope.${scope}`)}</Text>
      <Text style={{ color: data.safety.writable ? palette.tint : palette.muted }} variant="label">{data.safety.writable ? t('settings:extensions.safety.writable') : `${t('settings:extensions.safety.readOnly')}: ${data.safety.reason}`}</Text>
      {data.target ? <Text selectable className={cn("text-muted-foreground")} variant="label">{t('settings:extensions.safety.target', { path: data.target.path })}</Text> : null}
      {data.safety.backupPath ? <Text selectable className={cn("text-muted-foreground")} variant="label">{t('settings:extensions.safety.backup', { path: data.safety.backupPath })}</Text> : null}
      {data.safety.backupPath ? <Button disabled={busy} onPress={onRestore} variant="ghost"><Text>{t('settings:extensions.safety.restore')}</Text></Button> : null}
    </View>
  );
}

function ReadOnlyRows<T extends { key: string }>({ title, rows, render }: { title: string; rows: T[]; render: (row: T) => ReactNode }) {
  const { t } = useTranslation();

  if (rows.length === 0) return null;
  return (
    <View className={cn(stylesClasses.shared)}>
      <Text className={cn("text-muted-foreground")} variant="description">{title}</Text>
      {rows.map((row) => <View key={row.key} className={cn(stylesClasses.row, "border-border")}>{render(row)}</View>)}
      <FieldDescription  invalid={false}>{t('settings:extensions.sharedHint')}</FieldDescription>
    </View>
  );
}

export function ExtensionsSection() {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const palette = usePalette();
  const mcp = useMcp();
  const { activeProjectPath } = useProjects();
  const { extensions } = useExtensions();
  const [scope, setScope] = useState<ExtensionScope>(activeProjectPath ? 'project' : 'general');
  const target = useSettingsTarget();
  const [tab, setTab] = useState<Tab>(() => (['plugins', 'skills', 'commands'] as const).find((entry) => target?.group?.startsWith(`extensions-${entry}`)) ?? 'mcp');
  const mcpForm = useForm<McpDraft>({ resolver: zodResolver(mcpSchema), defaultValues: { name: '', target: '', type: target?.group === 'extensions-mcp-remote' ? 'remote' : 'local' }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const skillForm = useForm<SkillDraft>({ resolver: zodResolver(skillSchema), defaultValues: { id: '', name: '', description: '', instructions: '', autoinvoke: true }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const commandForm = useForm<CommandDraft>({ resolver: zodResolver(commandSchema), defaultValues: { name: '', description: '', template: '' }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const [generalConfirmed, setGeneralConfirmed] = useState(false);
  const [mcpBusy, setMcpBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const { field: { value: mcpName, onChange: setMcpName, ref: mcpNameRef, onBlur: mcpNameBlur } } = useController({ control: mcpForm.control, name: 'name' });
  const { field: { value: mcpType, onChange: setMcpType } } = useController({ control: mcpForm.control, name: 'type' });
  const { field: { value: mcpTarget, onChange: setMcpTarget, ref: mcpTargetRef, onBlur: mcpTargetBlur } } = useController({ control: mcpForm.control, name: 'target' });
  const [pluginTarget, setPluginTarget] = useState('');
  const { field: { value: skillId, onChange: setSkillId, ref: skillIdRef, onBlur: skillIdBlur } } = useController({ control: skillForm.control, name: 'id' });
  const { field: { value: skillName, onChange: setSkillName, ref: skillNameRef, onBlur: skillNameBlur } } = useController({ control: skillForm.control, name: 'name' });
  const { field: { value: skillDescription, onChange: setSkillDescription, ref: skillDescriptionRef, onBlur: skillDescriptionBlur } } = useController({ control: skillForm.control, name: 'description' });
  const { field: { value: skillInstructions, onChange: setSkillInstructions, ref: skillInstructionsRef, onBlur: skillInstructionsBlur } } = useController({ control: skillForm.control, name: 'instructions' });
  const { field: { value: skillAutoinvoke, onChange: setSkillAutoinvoke } } = useController({ control: skillForm.control, name: 'autoinvoke' });
  const [editingSkill, setEditingSkill] = useState<ExtensionSkillRow>();
  const [skillContent, setSkillContent] = useState('');
  const { field: { value: commandName, onChange: setCommandName, ref: commandNameRef, onBlur: commandNameBlur } } = useController({ control: commandForm.control, name: 'name' });
  const { field: { value: commandDescription, onChange: setCommandDescription, ref: commandDescriptionRef, onBlur: commandDescriptionBlur } } = useController({ control: commandForm.control, name: 'description' });
  const { field: { value: commandTemplate, onChange: setCommandTemplate, ref: commandTemplateRef, onBlur: commandTemplateBlur } } = useController({ control: commandForm.control, name: 'template' });
  const [editingCommand, setEditingCommand] = useState<string>();
  const authentication = useMcpAuthentication(mcp.mcpOAuth, palette);
  const effectiveScope: ExtensionScope = scope === 'project' && !activeProjectPath ? 'general' : scope;
  const data = extensions.snapshot?.[effectiveScope];
  const busy = Boolean(extensions.busy) || Boolean(mcpBusy);
  const refreshExtensions = extensions.refresh;

  useEffect(() => { void refreshExtensions().catch(() => undefined); }, [refreshExtensions]);

  function clearForms() {
    mcpForm.clearErrors(); skillForm.clearErrors(); commandForm.clearErrors();
    setActionError(undefined);
    setMcpName(''); setMcpTarget(''); setPluginTarget('');
    setSkillId(''); setSkillName(''); setSkillDescription(''); setSkillInstructions(''); setEditingSkill(undefined); setSkillContent('');
    setCommandName(''); setCommandDescription(''); setCommandTemplate(''); setEditingCommand(undefined);
  }

  function changeScope(next: string) {
    setScope(next as ExtensionScope);
    setGeneralConfirmed(false);
    clearForms();
  }

  async function runMcp(name: string, action: () => Promise<void>) {
    setMcpBusy(name);
    setActionError(undefined);
    try { await action(); await extensions.refresh(); } catch (failure) { setActionError(getErrorMessage(failure)); } finally { setMcpBusy(undefined); }
  }

  function confirmScope(action: () => void) {
    if (effectiveScope !== 'general' || generalConfirmed) {
      action();
      return;
    }
    confirmAction(
      t('settings:extensions.generalConfirmTitle'),
      t('settings:extensions.generalConfirmMessage', { path: data?.target?.path || '' }),
      t('settings:extensions.generalConfirmAction'),
      t('common:actions.cancel'),
      () => { setGeneralConfirmed(true); action(); },
    );
  }

  async function submitMcp() {
    if (!await mcpForm.trigger()) return;
    if (!mcpName.trim() || !mcpTarget.trim()) return;
    try {
      const config = mcpType === 'local'
        ? { type: 'local' as const, command: JSON.parse(mcpTarget) as string[] }
        : { type: 'remote' as const, url: mcpTarget.trim() };
      if (config.type === 'local' && (!config.command.length || config.command.some((part) => typeof part !== 'string'))) return;
      setActionError(undefined);
      confirmScope(() => { void extensions.addMcp(effectiveScope, mcpName.trim(), config).then(() => { setMcpName(''); setMcpTarget(''); }).catch(() => undefined); });
    } catch (failure) {
      setActionError(getErrorMessage(failure));
    }
  }

  function submitPlugin() {
    if (!pluginTarget.trim()) return;
    confirmScope(() => { void extensions.addPlugin(effectiveScope, pluginTarget.trim()).then(() => setPluginTarget('')).catch(() => undefined); });
  }

  async function submitSkill() {
    if (!editingSkill && !await skillForm.trigger()) return;
    if (editingSkill) {
      confirmScope(() => { void extensions.updateSkill(effectiveScope, editingSkill, skillContent).then(() => { setEditingSkill(undefined); setSkillContent(''); }).catch(() => undefined); });
      return;
    }
    const id = skillId.trim() || slugifySkillId(skillName);
    confirmScope(() => { void extensions.createSkill(effectiveScope, {
      id,
      name: skillName.trim() || id,
      description: skillDescription,
      instructions: skillInstructions,
      autoinvoke: skillAutoinvoke,
    }).then(() => { setSkillId(''); setSkillName(''); setSkillDescription(''); setSkillInstructions(''); }).catch(() => undefined); });
  }

  async function submitCommand() {
    if (!await commandForm.trigger()) return;
    if (!commandName.trim() || !commandTemplate.trim()) return;
    confirmScope(() => { void extensions.saveCommand(effectiveScope, {
      name: commandName.trim(),
      description: commandDescription,
      template: commandTemplate,
    }, editingCommand).then(() => { setCommandName(''); setCommandDescription(''); setCommandTemplate(''); setEditingCommand(undefined); }).catch(() => undefined); });
  }

  function remove(title: string, message: string, action: () => void) {
    confirmAction(title, message, t('common:actions.remove'), t('common:actions.cancel'), action);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mcp', label: t('settings:extensions.tabs.mcp') },
    { key: 'plugins', label: t('settings:extensions.tabs.plugins') },
    { key: 'skills', label: t('settings:extensions.tabs.skills') },
    { key: 'commands', label: t('settings:extensions.tabs.commands') },
  ];

  return <>{confirmation}{(
    <Tabs value={tab} onValueChange={(value) => { setTab(value as Tab); clearForms(); }} className={cn(stylesClasses.content)}>
      <SettingTarget label={t(`settings:extensions.tabs.${tab}`)}>
      <Text className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:extensions.title')}</Text>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:extensions.description')}</Text>
      <ToggleGroup type="single" value={effectiveScope} onValueChange={(value) => { if (value) changeScope(value); }} className="flex-row flex-wrap">{([
          { value: 'project', label: t('settings:extensions.scope.project'), disabled: !activeProjectPath },
          { value: 'general', label: t('settings:extensions.scope.general') },
        ]).map((option) => <ToggleGroupItem key={option.value} value={option.value} disabled={'disabled' in option && option.disabled === true}><Text>{option.label}</Text></ToggleGroupItem>)}</ToggleGroup>
      {extensions.error ? <FieldDescription testID="extensions-error" invalid={true}>{extensions.error}</FieldDescription> : null}
      {[mcpForm, skillForm, commandForm].flatMap((form) => Object.values(form.formState.errors)).map((error, index) => error?.message ? <FieldDescription key={index} invalid>{t(String(error.message))}</FieldDescription> : null)}
      {actionError ? <FieldDescription testID="extensions-action-error" invalid={true}>{actionError}</FieldDescription> : null}
      {data ? <SafetyCard data={data} scope={effectiveScope} busy={busy} onRestore={() => remove(t('settings:extensions.safety.restore'), t('settings:extensions.safety.restoreMessage'), () => { void extensions.restoreBackup(effectiveScope).catch(() => undefined); })} /> : <Spinner className={cn(stylesClasses.loading)} />}
      <TabsList className={cn(stylesClasses.tabs)}>{tabs.map((item) => <TabsTrigger key={item.key} value={item.key}><Text>{item.label}</Text></TabsTrigger>)}</TabsList>
      <TabsContent value={tab} className="gap-3">
      {data ? <Text className={cn("text-muted-foreground")} variant="label">{t(`settings:extensions.scopeDescription.${effectiveScope}`, { project: activeProjectPath || '' })}</Text> : null}

      {tab === 'mcp' ? (
        <View className={cn(stylesClasses.section)}>
          <Text  variant="title">{t('settings:extensions.mcp.addTitle')}</Text>
          <SettingField testID="settings-extension-mcp-name" label={t('settings:mcp.serverName')} ref={mcpNameRef} onBlur={mcpNameBlur} value={mcpName} onChangeText={setMcpName} autoCapitalize="none" autoCorrect={false}></SettingField>
          <ToggleGroup type="single" value={mcpType} onValueChange={(value) => { if (!value) return; setMcpType(value as 'local' | 'remote'); setMcpTarget(''); }} className="flex-row flex-wrap">{([{ value: 'local', label: t('settings:mcp.local') }, { value: 'remote', label: t('settings:mcp.remote') }]).map((option) => <ToggleGroupItem key={option.value} value={option.value} disabled={'disabled' in option && option.disabled === true}><Text>{option.label}</Text></ToggleGroupItem>)}</ToggleGroup>
          <SettingField testID="settings-extension-mcp-target" label={mcpType === 'local' ? t('settings:mcp.commandArguments') : t('settings:mcp.url')} placeholder={mcpType === 'local' ? '["npx","@modelcontextprotocol/server"]' : 'https://example.com/mcp'} ref={mcpTargetRef} onBlur={mcpTargetBlur} value={mcpTarget} onChangeText={setMcpTarget} autoCapitalize="none" autoCorrect={false}></SettingField>
          <Button testID="settings-extension-mcp-add" disabled={busy || !data?.safety.writable} onPress={submitMcp} variant="default"><Text>{t('settings:extensions.mcp.add')}</Text></Button>
          {data?.items.mcp.length === 0 ? <FieldDescription  invalid={false}>{t('settings:extensions.mcp.empty')}</FieldDescription> : null}
          {data?.items.mcp.map((row) => {
            const status = row.status?.status;
            const integrationID = row.status && 'integrationID' in row.status ? row.status.integrationID : undefined;
            return (
              <View key={row.key} className={cn(stylesClasses.row, "border-border")}>
                <ListRow title={row.name} description={row.config ? describeMcp(row.config) : t('settings:extensions.mcp.runtime')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Badge  variant="secondary"><Text>{status || t('settings:extensions.mcp.configured')}</Text></Badge>}></ListRow>
                <View className={cn(stylesClasses.actions)}>
                  <Button disabled={busy} onPress={() => void runMcp(row.name, () => status === 'connected' ? mcp.disconnectMcpServer(row.name) : mcp.connectMcpServer(row.name))} variant="ghost"><Text>{status === 'connected' ? t('common:actions.disconnect') : t('common:actions.connect')}</Text></Button>
                  {status === 'needs_auth' && integrationID ? <Button disabled={busy} onPress={() => void authentication.open(row.name).catch(() => undefined)} variant="ghost"><Text>{t('settings:mcp.oauth')}</Text></Button> : null}
                  {row.removeMode !== 'none' ? <Button testID={`settings-extension-mcp-remove-${row.name.replace(/[^a-z0-9]+/gi, '-')}`} disabled={busy || (row.removeMode === 'config' && !row.editable)} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.mcp.removeMessage', { name: row.name }), () => { void extensions.removeMcp(effectiveScope, row.name).catch(() => undefined); })} variant="ghost"><Text className={cn("text-destructive")} >{t('common:actions.remove')}</Text></Button> : null}
                </View>
              </View>
            );
          })}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={data.shared.mcp} render={(row) => <ListRow title={row.name} description={row.status?.status || t('settings:extensions.shared')} right={() => <Badge  variant="secondary"><Text>{row.source}</Text></Badge>}></ListRow>} /> : null}
        </View>
      ) : null}

      {tab === 'plugins' ? (
        <View className={cn(stylesClasses.section)}>
          <Text  variant="title">{t('settings:extensions.plugins.addTitle')}</Text>
          <SettingField testID="settings-extension-plugin-target" label={t('settings:extensions.plugins.package')} value={pluginTarget} onChangeText={setPluginTarget} autoCapitalize="none" autoCorrect={false}></SettingField>
          <FieldDescription  invalid={false}>{t('settings:extensions.plugins.warning')}</FieldDescription>
          <Button testID="settings-extension-plugin-add" disabled={busy || !data?.safety.writable} onPress={submitPlugin} variant="default"><Text>{t('settings:extensions.plugins.add')}</Text></Button>
          {data?.items.plugins.length === 0 ? <FieldDescription  invalid={false}>{t('settings:extensions.plugins.empty')}</FieldDescription> : null}
          {data?.items.plugins.map((row) => (
            <View key={row.key} className={cn(stylesClasses.row, "border-border")}>
              <ListRow title={row.label} description={[row.version, row.status, row.outdated ? t('settings:extensions.plugins.outdated') : undefined].filter(Boolean).join(' · ')} right={() => <Badge  variant="secondary"><Text>{row.source}</Text></Badge>}></ListRow>
              {row.target ? <View className={cn(stylesClasses.actions)}><Button testID={`settings-extension-plugin-remove-${row.label.replace(/[^a-z0-9]+/gi, '-')}`} disabled={busy || !row.editable} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.plugins.removeMessage', { name: row.label }), () => { void extensions.removePlugin(effectiveScope, row.target!).catch(() => undefined); })} variant="ghost"><Text className={cn("text-destructive")} >{t('common:actions.remove')}</Text></Button></View> : null}
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.plugins)} render={(row) => <ListRow title={row.label} description={row.source}></ListRow>} /> : null}
        </View>
      ) : null}

      {tab === 'skills' ? (
        <View className={cn(stylesClasses.section)}>
          {editingSkill ? <>
            <Text  variant="title">{t('settings:extensions.skills.editTitle', { name: editingSkill.name })}</Text>
            <SettingField multiline numberOfLines={10} label={t('settings:extensions.skills.fileContent')} value={skillContent} onChangeText={setSkillContent} autoCapitalize="none" autoCorrect={false}></SettingField>
            <View className={cn(stylesClasses.actions)}><Button disabled={busy || !data?.safety.writable} onPress={submitSkill} variant="default"><Text>{t('common:actions.save')}</Text></Button><Button disabled={busy} onPress={() => { setEditingSkill(undefined); setSkillContent(''); }} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button></View>
          </> : <>
            <Text  variant="title">{t('settings:extensions.skills.addTitle')}</Text>
            <SettingField testID="settings-extension-skill-id" label={t('settings:extensions.skills.id')} ref={skillIdRef} onBlur={skillIdBlur} value={skillId} onChangeText={setSkillId} autoCapitalize="none" autoCorrect={false} placeholder={slugifySkillId(skillName) || 'my-skill'}></SettingField>
            <SettingField testID="settings-extension-skill-name" label={t('settings:extensions.skills.name')} ref={skillNameRef} onBlur={skillNameBlur} value={skillName} onChangeText={setSkillName}></SettingField>
            <SettingField testID="settings-extension-skill-description" label={t('settings:extensions.skills.descriptionLabel')} ref={skillDescriptionRef} onBlur={skillDescriptionBlur} value={skillDescription} onChangeText={setSkillDescription}></SettingField>
            <SettingField testID="settings-extension-skill-instructions" multiline numberOfLines={6} label={t('settings:extensions.skills.instructions')} ref={skillInstructionsRef} onBlur={skillInstructionsBlur} value={skillInstructions} onChangeText={setSkillInstructions}></SettingField>
            <Button onPress={() => setSkillAutoinvoke(!skillAutoinvoke)} variant="outline"><Text>{skillAutoinvoke ? t('settings:extensions.skills.autoinvokeOn') : t('settings:extensions.skills.autoinvokeOff')}</Text></Button>
            <Button testID="settings-extension-skill-add" disabled={busy || !data?.safety.writable} onPress={submitSkill} variant="default"><Text>{t('settings:extensions.skills.add')}</Text></Button>
          </>}
          {data?.items.skills.length === 0 ? <FieldDescription  invalid={false}>{t('settings:extensions.skills.empty')}</FieldDescription> : null}
          {data?.items.skills.map((row) => (
            <View key={row.key} className={cn(stylesClasses.row, "border-border")}>
              <ListRow title={row.name || row.id} description={row.description || row.path} right={() => <Badge  variant="secondary"><Text>{row.id}</Text></Badge>}></ListRow>
              <View className={cn(stylesClasses.actions)}>
                {row.editable ? <Button disabled={busy} onPress={() => { setEditingSkill(row); setSkillContent(row.content || ''); }} variant="ghost"><Text>{t('common:actions.edit')}</Text></Button> : null}
                {row.removable ? <Button testID={`settings-extension-skill-remove-${row.id.replace(/[^a-z0-9]+/gi, '-')}`} disabled={busy} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.skills.removeMessage', { name: row.name }), () => { void extensions.removeSkill(effectiveScope, row).catch(() => undefined); })} variant="ghost"><Text className={cn("text-destructive")} >{t('common:actions.remove')}</Text></Button> : null}
              </View>
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.skills)} render={(row) => <ListRow title={row.name} description={row.description || row.path}></ListRow>} /> : null}
        </View>
      ) : null}

      {tab === 'commands' ? (
        <View className={cn(stylesClasses.section)}>
          <Text  variant="title">{editingCommand ? t('settings:extensions.commands.editTitle', { name: editingCommand }) : t('settings:extensions.commands.addTitle')}</Text>
          <SettingField testID="settings-extension-command-name" label={t('settings:extensions.commands.name')} ref={commandNameRef} onBlur={commandNameBlur} value={commandName} onChangeText={setCommandName} autoCapitalize="none" autoCorrect={false}></SettingField>
          <SettingField testID="settings-extension-command-description" label={t('settings:extensions.commands.descriptionLabel')} ref={commandDescriptionRef} onBlur={commandDescriptionBlur} value={commandDescription} onChangeText={setCommandDescription}></SettingField>
          <SettingField testID="settings-extension-command-template" multiline numberOfLines={5} label={t('settings:extensions.commands.template')} ref={commandTemplateRef} onBlur={commandTemplateBlur} value={commandTemplate} onChangeText={setCommandTemplate}></SettingField>
          <FieldDescription  invalid={false}>{t('settings:extensions.commands.templateHint')}</FieldDescription>
          <View className={cn(stylesClasses.actions)}><Button testID="settings-extension-command-save" disabled={busy || !data?.safety.writable} onPress={submitCommand} variant="default"><Text>{t('common:actions.save')}</Text></Button>{editingCommand ? <Button disabled={busy} onPress={() => { setEditingCommand(undefined); setCommandName(''); setCommandDescription(''); setCommandTemplate(''); }} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button> : null}</View>
          {data?.items.commands.length === 0 ? <FieldDescription  invalid={false}>{t('settings:extensions.commands.empty')}</FieldDescription> : null}
          {data?.items.commands.map((row) => (
            <View key={row.key} className={cn(stylesClasses.row, "border-border")}>
              <ListRow title={`/${row.name}`} description={row.description || row.template}></ListRow>
              <View className={cn(stylesClasses.actions)}>
                {row.editable ? <Button disabled={busy} onPress={() => { setEditingCommand(row.name); setCommandName(row.name); setCommandDescription(row.description || ''); setCommandTemplate(row.template || ''); }} variant="ghost"><Text>{t('common:actions.edit')}</Text></Button> : null}
                {row.editable ? <Button testID={`settings-extension-command-remove-${row.name.replace(/[^a-z0-9]+/gi, '-')}`} disabled={busy} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.commands.removeMessage', { name: row.name }), () => { void extensions.removeCommand(effectiveScope, row.name).catch(() => undefined); })} variant="ghost"><Text className={cn("text-destructive")} >{t('common:actions.remove')}</Text></Button> : null}
              </View>
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.commands)} render={(row) => <ListRow title={`/${row.name}`} description={row.description || t('settings:extensions.shared')}></ListRow>} /> : null}
        </View>
      ) : null}
      </TabsContent>
      {authentication.dialog}
      {extensions.busy ? <FieldDescription  invalid={false}>{t('settings:extensions.saving')}</FieldDescription> : null}
      {!data && !extensions.isRefreshing ? <FieldDescription  invalid={false}>{t('settings:extensions.unavailable')}</FieldDescription> : null}
    </SettingTarget></Tabs>
  )}</>;
}

function describeMcp(config: Record<string, unknown>) {
  if (config.type === 'remote') return String(config.url || '');
  return Array.isArray(config.command) ? config.command.join(' ') : '';
}

const stylesClasses = {
  "card": "rounded-[14px] border gap-1 p-3",
  "shared": "gap-1.5 mt-2",
  "row": "rounded-[12px] border overflow-hidden",
  "content": "gap-3 px-4 pb-8",
  "title": "font-semibold",
  "loading": "my-6",
  "tabs": "flex-row flex-wrap gap-1.5",
  "section": "gap-2.5",
  "actions": "flex-row flex-wrap justify-end gap-1 px-1 pb-1.5"
} as const;
