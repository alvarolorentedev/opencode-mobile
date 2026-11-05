import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExtensions, useMcp } from '@/features/extensions/context';
import { useProjects } from '@/features/projects/context';
import { ProjectContextPicker } from '@/features/projects/index';
import { useConnection } from '@/features/connections/context';
import { AgentEditor } from '@/features/extensions/ui/agent-editor';
import { CommandEditor } from '@/features/extensions/ui/command-editor';
import { SkillEditor } from '@/features/extensions/ui/skill-editor';
import { McpEditor } from '@/features/extensions/ui/mcp-editor';
import { PluginEditor } from '@/features/extensions/ui/plugin-editor';
import { ExtensionInventory, type ExtensionSelection, type ExtensionTab } from '@/features/extensions/ui/extension-inventory';
import { useMcpAuthentication } from '@/features/extensions/ui/use-mcp-authentication';
import { SettingTarget, SettingsDisclosure, useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { FieldDescription } from '@/shared/ui/text-field';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { getErrorMessage } from '@/shared/utilities/error-message';
import type { ExtensionScope } from '@/shared/protocol/opencode/extensions/types';

const tabs: ExtensionTab[] = ['mcp', 'plugins', 'agents', 'skills', 'commands'];
const singular = { mcp: 'mcp', plugins: 'plugin', agents: 'agent', skills: 'skill', commands: 'command' } as const;

export function ExtensionsSection() {
  const { t } = useTranslation();
  const palette = usePalette();
  const target = useSettingsTarget();
  const { confirmAction, confirmation } = useConfirmation();
  const { activeProjectPath } = useProjects();
  const { settings } = useConnection();
  const { extensions } = useExtensions();
  const mcp = useMcp();
  const authentication = useMcpAuthentication(mcp.mcpOAuth, palette);
  const [scope, setScope] = useState<ExtensionScope>(activeProjectPath ? 'project' : 'general');
  const [tab, setTab] = useState<ExtensionTab>(() => tabs.find((entry) => target?.group?.startsWith(`extensions-${entry}`)) ?? 'mcp');
  const [selection, setSelection] = useState<ExtensionSelection | undefined>(() => target && target.label !== t(`settings:extensions.tabs.${tab}`) ? { type: tab } : undefined);
  const [generalConfirmed, setGeneralConfirmed] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const effectiveScope: ExtensionScope = scope === 'project' && !activeProjectPath ? 'general' : scope;
  const data = extensions.snapshot?.[effectiveScope];
  const busy = Boolean(extensions.busy) || mcpBusy;
  const refresh = extensions.refresh;
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  function save(action: () => Promise<void>) {
    const perform = () => { void action().catch((failure) => setActionError(getErrorMessage(failure))); };
    setActionError(undefined);
    if (effectiveScope === 'general' && !generalConfirmed) {
      confirmAction(t('settings:extensions.generalConfirmTitle'), t('settings:extensions.generalConfirmMessage', { path: data?.target?.path || '' }), t('settings:extensions.generalConfirmAction'), t('common:actions.cancel'), () => { setGeneralConfirmed(true); perform(); });
    } else perform();
  }
  function remove(message: string, action: () => Promise<void>) {
    confirmAction(t('settings:extensions.removeTitle'), message, t('common:actions.remove'), t('common:actions.cancel'), () => { void action().catch((failure) => setActionError(getErrorMessage(failure))); });
  }
  function runMcp(action: () => Promise<void>) {
    setMcpBusy(true); setActionError(undefined);
    void action().then(() => extensions.refresh()).catch((failure) => setActionError(getErrorMessage(failure))).finally(() => setMcpBusy(false));
  }
  const canAdd = Boolean(data && (tab === 'agents' || tab === 'commands' ? data.markdown[tab].safety.writable : data.safety.writable)) && !(tab === 'agents' || tab === 'commands' ? extensions.snapshot?.errors[tab] : false);
  const editorProps = { scope: effectiveScope, context: `${settings.serverUrl} · ${t(`settings:extensions.scope.${effectiveScope}`)}${effectiveScope === 'project' ? ` · ${activeProjectPath}` : ''}`, save, onClose: () => setSelection(undefined) };
  return <View className="gap-3 px-4 pb-8">
    <Text variant="description" className="text-muted-foreground">{t('settings:extensions.description')}</Text>
    <ToggleGroup type="single" value={effectiveScope} onValueChange={(value) => { if (value && !busy) { setScope(value as ExtensionScope); setGeneralConfirmed(false); } }} className="flex-row flex-wrap">
      <ToggleGroupItem value="project" disabled={!activeProjectPath || busy}><Text>{t('settings:extensions.scope.project')}</Text></ToggleGroupItem>
      <ToggleGroupItem value="general" disabled={busy}><Text>{t('settings:extensions.scope.general')}</Text></ToggleGroupItem>
    </ToggleGroup>
    <Text variant="description" className="text-muted-foreground">{t(`settings:extensions.scopeDescription.${effectiveScope}`, { project: activeProjectPath || '' })}</Text>
    {effectiveScope === 'project' ? <ProjectContextPicker /> : null}
    {extensions.error ? <FieldDescription invalid testID="extensions-error">{extensions.error}</FieldDescription> : null}
    {actionError ? <FieldDescription invalid testID="extensions-action-error">{actionError}</FieldDescription> : null}
    {!data ? extensions.isRefreshing ? <Spinner /> : <FieldDescription>{t('settings:extensions.unavailable')}</FieldDescription> : <>
      {!data.safety.writable ? <FieldDescription invalid>{`${t('settings:extensions.safety.readOnly')}: ${data.safety.reason || ''}`}</FieldDescription> : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as ExtensionTab)} className="gap-3">
        <TabsList className="flex-row flex-wrap gap-1 web:w-full">{tabs.map((entry) => <TabsTrigger key={entry} value={entry} className="web:h-auto"><Text>{t(`settings:extensions.tabs.${entry}`)}</Text></TabsTrigger>)}</TabsList>
        <TabsContent value={tab} className="gap-3"><SettingTarget label={t(`settings:extensions.tabs.${tab}`)}>
          {(tab === 'agents' || tab === 'commands') && extensions.snapshot?.errors[tab] ? <FieldDescription invalid testID={`extensions-${tab}-error`}>{extensions.snapshot.errors[tab]}</FieldDescription> : null}
          <Button testID={`settings-extension-${singular[tab]}-open`} disabled={busy || !canAdd} onPress={() => { setActionError(undefined); setSelection({ type: tab }); }}><Text>{t(`settings:extensions.${tab}.addTitle`)}</Text></Button>
          {!canAdd ? <FieldDescription>{(tab === 'agents' || tab === 'commands' ? data.markdown[tab].safety.reason : data.safety.reason) || t('settings:extensions.safety.readOnly')}</FieldDescription> : null}
          <ExtensionInventory tab={tab} data={data} scope={effectiveScope} busy={busy} onEdit={(next) => { setActionError(undefined); setSelection(next); }} onRemove={remove} runMcp={runMcp} authenticate={(name) => { void authentication.open(name).catch((failure) => setActionError(getErrorMessage(failure))); }} />
        </SettingTarget></TabsContent>
      </Tabs>
      <SettingsDisclosure id="extension-config-details" title={t('settings:extensions.editor.configDetails')}>
        <Text selectable variant="description">{t('settings:extensions.safety.target', { path: data.target?.path || t('settings:extensions.safety.missing') })}</Text>
        <Text selectable variant="description">{t('settings:extensions.safety.markdownAgents', { path: data.markdown.agents.root || t('settings:extensions.safety.missing') })}</Text>
        <Text selectable variant="description">{t('settings:extensions.safety.markdownCommands', { path: data.markdown.commands.root || t('settings:extensions.safety.missing') })}</Text>
        {data.safety.backupPath ? <><Text selectable variant="description">{t('settings:extensions.safety.backup', { path: data.safety.backupPath })}</Text>
          <Button variant="outline" disabled={busy} onPress={() => remove(t('settings:extensions.safety.restoreMessage'), () => extensions.restoreBackup(effectiveScope))}><Text>{t('settings:extensions.safety.restore')}</Text></Button></> : null}
      </SettingsDisclosure>
      {selection?.type === 'agents' ? <AgentEditor {...editorProps} row={selection.row} readOnly={selection.readOnly || Boolean(selection.row && !selection.row.editable) || (!selection.row && !data.markdown.agents.safety.writable)} /> : null}
      {selection?.type === 'commands' ? <CommandEditor {...editorProps} row={selection.row} /> : null}
      {selection?.type === 'skills' ? <SkillEditor {...editorProps} row={selection.row} /> : null}
      {selection?.type === 'mcp' ? <McpEditor {...editorProps} row={selection.row} remote={target?.group === 'extensions-mcp-remote'} /> : null}
      {selection?.type === 'plugins' ? <PluginEditor {...editorProps} /> : null}
    </>}
    {authentication.dialog}{confirmation}
  </View>;
}
