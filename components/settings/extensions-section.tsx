import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, HelperText, List, SegmentedButtons, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import { useMcpAuthentication } from '@/components/settings/use-mcp-authentication';
import { usePalette } from '@/hooks/use-palette';
import { confirmAction } from '@/lib/confirm-action';
import { getErrorMessage } from '@/lib/error-message';
import { slugifySkillId } from '@/lib/opencode/extensions/skills';
import { visibleSharedRows } from '@/lib/opencode/extensions/snapshot';
import type { ExtensionScope, ExtensionSkillRow, ExtensionSnapshot } from '@/lib/opencode/extensions/types';
import { useExtensions, useMcp, useProjects } from '@/providers/opencode-contexts';

type Tab = 'mcp' | 'plugins' | 'skills' | 'commands';

function SafetyCard({ data, scope, onRestore, busy }: { data: ExtensionSnapshot[ExtensionScope]; scope: ExtensionScope; onRestore: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <Text variant="titleSmall" style={{ color: palette.text }}>{t(`settings:extensions.scope.${scope}`)}</Text>
      <Text variant="bodySmall" style={{ color: data.safety.writable ? palette.tint : palette.muted }}>
        {data.safety.writable ? t('settings:extensions.safety.writable') : `${t('settings:extensions.safety.readOnly')}: ${data.safety.reason}`}
      </Text>
      {data.target ? <Text selectable variant="bodySmall" style={{ color: palette.muted }}>{t('settings:extensions.safety.target', { path: data.target.path })}</Text> : null}
      {data.safety.backupPath ? <Text selectable variant="bodySmall" style={{ color: palette.muted }}>{t('settings:extensions.safety.backup', { path: data.safety.backupPath })}</Text> : null}
      {data.safety.backupPath ? <Button compact disabled={busy} onPress={onRestore}>{t('settings:extensions.safety.restore')}</Button> : null}
    </View>
  );
}

function ReadOnlyRows<T extends { key: string }>({ title, rows, render }: { title: string; rows: T[]; render: (row: T) => ReactNode }) {
  const { t } = useTranslation();
  const palette = usePalette();
  if (rows.length === 0) return null;
  return (
    <View style={styles.shared}>
      <Text variant="labelLarge" style={{ color: palette.muted }}>{title}</Text>
      {rows.map((row) => <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>{render(row)}</View>)}
      <HelperText type="info">{t('settings:extensions.sharedHint')}</HelperText>
    </View>
  );
}

export function ExtensionsSection() {
  const { t } = useTranslation();
  const palette = usePalette();
  const mcp = useMcp();
  const { activeProjectPath } = useProjects();
  const { extensions } = useExtensions();
  const [scope, setScope] = useState<ExtensionScope>(activeProjectPath ? 'project' : 'general');
  const [tab, setTab] = useState<Tab>('mcp');
  const [generalConfirmed, setGeneralConfirmed] = useState(false);
  const [mcpBusy, setMcpBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [mcpName, setMcpName] = useState('');
  const [mcpType, setMcpType] = useState<'local' | 'remote'>('local');
  const [mcpTarget, setMcpTarget] = useState('');
  const [pluginTarget, setPluginTarget] = useState('');
  const [skillId, setSkillId] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [skillInstructions, setSkillInstructions] = useState('');
  const [skillAutoinvoke, setSkillAutoinvoke] = useState(true);
  const [editingSkill, setEditingSkill] = useState<ExtensionSkillRow>();
  const [skillContent, setSkillContent] = useState('');
  const [commandName, setCommandName] = useState('');
  const [commandDescription, setCommandDescription] = useState('');
  const [commandTemplate, setCommandTemplate] = useState('');
  const [editingCommand, setEditingCommand] = useState<string>();
  const authentication = useMcpAuthentication(mcp.mcpOAuth, palette);
  const effectiveScope: ExtensionScope = scope === 'project' && !activeProjectPath ? 'general' : scope;
  const data = extensions.snapshot?.[effectiveScope];
  const busy = Boolean(extensions.busy) || Boolean(mcpBusy);
  const refreshExtensions = extensions.refresh;

  useEffect(() => { void refreshExtensions().catch(() => undefined); }, [refreshExtensions]);

  function clearForms() {
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

  function submitMcp() {
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

  function submitSkill() {
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

  function submitCommand() {
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

  return (
    <View style={styles.content}>
      <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:extensions.title')}</Text>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:extensions.description')}</Text>
      <SegmentedButtons
        value={effectiveScope}
        onValueChange={changeScope}
        buttons={[
          { value: 'project', label: t('settings:extensions.scope.project'), disabled: !activeProjectPath },
          { value: 'general', label: t('settings:extensions.scope.general') },
        ]}
      />
      {extensions.error ? <HelperText testID="extensions-error" type="error">{extensions.error}</HelperText> : null}
      {actionError ? <HelperText testID="extensions-action-error" type="error">{actionError}</HelperText> : null}
      {data ? <SafetyCard data={data} scope={effectiveScope} busy={busy} onRestore={() => remove(t('settings:extensions.safety.restore'), t('settings:extensions.safety.restoreMessage'), () => { void extensions.restoreBackup(effectiveScope).catch(() => undefined); })} /> : <ActivityIndicator style={styles.loading} />}
      <View style={styles.tabs}>
        {tabs.map((item) => <Chip key={item.key} selected={tab === item.key} onPress={() => { setTab(item.key); clearForms(); }}>{item.label}</Chip>)}
      </View>
      {data ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t(`settings:extensions.scopeDescription.${effectiveScope}`, { project: activeProjectPath || '' })}</Text> : null}

      {tab === 'mcp' ? (
        <View style={styles.section}>
          <Text variant="titleMedium">{t('settings:extensions.mcp.addTitle')}</Text>
          <TextInput testID="settings-extension-mcp-name" mode="outlined" label={t('settings:mcp.serverName')} value={mcpName} onChangeText={setMcpName} autoCapitalize="none" autoCorrect={false} />
          <SegmentedButtons value={mcpType} onValueChange={(value) => { setMcpType(value as 'local' | 'remote'); setMcpTarget(''); }} buttons={[{ value: 'local', label: t('settings:mcp.local') }, { value: 'remote', label: t('settings:mcp.remote') }]} />
          <TextInput testID="settings-extension-mcp-target" mode="outlined" label={mcpType === 'local' ? t('settings:mcp.commandArguments') : t('settings:mcp.url')} placeholder={mcpType === 'local' ? '["npx","@modelcontextprotocol/server"]' : 'https://example.com/mcp'} value={mcpTarget} onChangeText={setMcpTarget} autoCapitalize="none" autoCorrect={false} />
          <Button testID="settings-extension-mcp-add" mode="contained" disabled={busy || !data?.safety.writable} onPress={submitMcp}>{t('settings:extensions.mcp.add')}</Button>
          {data?.items.mcp.length === 0 ? <HelperText type="info">{t('settings:extensions.mcp.empty')}</HelperText> : null}
          {data?.items.mcp.map((row) => {
            const status = row.status?.status;
            const integrationID = row.status && 'integrationID' in row.status ? row.status.integrationID : undefined;
            return (
              <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>
                <List.Item title={row.name} description={row.config ? describeMcp(row.config) : t('settings:extensions.mcp.runtime')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Chip compact>{status || t('settings:extensions.mcp.configured')}</Chip>} />
                <View style={styles.actions}>
                  <Button compact disabled={busy} onPress={() => void runMcp(row.name, () => status === 'connected' ? mcp.disconnectMcpServer(row.name) : mcp.connectMcpServer(row.name))}>{status === 'connected' ? t('common:actions.disconnect') : t('common:actions.connect')}</Button>
                  {status === 'needs_auth' && integrationID ? <Button compact disabled={busy} onPress={() => void authentication.open(row.name).catch(() => undefined)}>{t('settings:mcp.oauth')}</Button> : null}
                  {row.removeMode !== 'none' ? <Button testID={`settings-extension-mcp-remove-${row.name.replace(/[^a-z0-9]+/gi, '-')}`} compact textColor={palette.danger} disabled={busy || (row.removeMode === 'config' && !row.editable)} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.mcp.removeMessage', { name: row.name }), () => { void extensions.removeMcp(effectiveScope, row.name).catch(() => undefined); })}>{t('common:actions.remove')}</Button> : null}
                </View>
              </View>
            );
          })}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={data.shared.mcp} render={(row) => <List.Item title={row.name} description={row.status?.status || t('settings:extensions.shared')} right={() => <Chip compact>{row.source}</Chip>} />} /> : null}
        </View>
      ) : null}

      {tab === 'plugins' ? (
        <View style={styles.section}>
          <Text variant="titleMedium">{t('settings:extensions.plugins.addTitle')}</Text>
          <TextInput testID="settings-extension-plugin-target" mode="outlined" label={t('settings:extensions.plugins.package')} value={pluginTarget} onChangeText={setPluginTarget} autoCapitalize="none" autoCorrect={false} />
          <HelperText type="info">{t('settings:extensions.plugins.warning')}</HelperText>
          <Button testID="settings-extension-plugin-add" mode="contained" disabled={busy || !data?.safety.writable} onPress={submitPlugin}>{t('settings:extensions.plugins.add')}</Button>
          {data?.items.plugins.length === 0 ? <HelperText type="info">{t('settings:extensions.plugins.empty')}</HelperText> : null}
          {data?.items.plugins.map((row) => (
            <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>
              <List.Item title={row.label} description={[row.version, row.status, row.outdated ? t('settings:extensions.plugins.outdated') : undefined].filter(Boolean).join(' · ')} right={() => <Chip compact>{row.source}</Chip>} />
              {row.target ? <View style={styles.actions}><Button testID={`settings-extension-plugin-remove-${row.label.replace(/[^a-z0-9]+/gi, '-')}`} compact textColor={palette.danger} disabled={busy || !row.editable} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.plugins.removeMessage', { name: row.label }), () => { void extensions.removePlugin(effectiveScope, row.target!).catch(() => undefined); })}>{t('common:actions.remove')}</Button></View> : null}
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.plugins)} render={(row) => <List.Item title={row.label} description={row.source} />} /> : null}
        </View>
      ) : null}

      {tab === 'skills' ? (
        <View style={styles.section}>
          {editingSkill ? <>
            <Text variant="titleMedium">{t('settings:extensions.skills.editTitle', { name: editingSkill.name })}</Text>
            <TextInput mode="outlined" multiline numberOfLines={10} label={t('settings:extensions.skills.fileContent')} value={skillContent} onChangeText={setSkillContent} autoCapitalize="none" autoCorrect={false} />
            <View style={styles.actions}><Button mode="contained" disabled={busy || !data?.safety.writable} onPress={submitSkill}>{t('common:actions.save')}</Button><Button disabled={busy} onPress={() => { setEditingSkill(undefined); setSkillContent(''); }}>{t('common:actions.cancel')}</Button></View>
          </> : <>
            <Text variant="titleMedium">{t('settings:extensions.skills.addTitle')}</Text>
            <TextInput testID="settings-extension-skill-id" mode="outlined" label={t('settings:extensions.skills.id')} value={skillId} onChangeText={setSkillId} autoCapitalize="none" autoCorrect={false} placeholder={slugifySkillId(skillName) || 'my-skill'} />
            <TextInput testID="settings-extension-skill-name" mode="outlined" label={t('settings:extensions.skills.name')} value={skillName} onChangeText={setSkillName} />
            <TextInput testID="settings-extension-skill-description" mode="outlined" label={t('settings:extensions.skills.descriptionLabel')} value={skillDescription} onChangeText={setSkillDescription} />
            <TextInput testID="settings-extension-skill-instructions" mode="outlined" multiline numberOfLines={6} label={t('settings:extensions.skills.instructions')} value={skillInstructions} onChangeText={setSkillInstructions} />
            <Button mode="outlined" onPress={() => setSkillAutoinvoke((value) => !value)}>{skillAutoinvoke ? t('settings:extensions.skills.autoinvokeOn') : t('settings:extensions.skills.autoinvokeOff')}</Button>
            <Button testID="settings-extension-skill-add" mode="contained" disabled={busy || !data?.safety.writable} onPress={submitSkill}>{t('settings:extensions.skills.add')}</Button>
          </>}
          {data?.items.skills.length === 0 ? <HelperText type="info">{t('settings:extensions.skills.empty')}</HelperText> : null}
          {data?.items.skills.map((row) => (
            <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>
              <List.Item title={row.name || row.id} description={row.description || row.path} right={() => <Chip compact>{row.id}</Chip>} />
              <View style={styles.actions}>
                {row.editable ? <Button compact disabled={busy} onPress={() => { setEditingSkill(row); setSkillContent(row.content || ''); }}>{t('common:actions.edit')}</Button> : null}
                {row.removable ? <Button testID={`settings-extension-skill-remove-${row.id.replace(/[^a-z0-9]+/gi, '-')}`} compact textColor={palette.danger} disabled={busy} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.skills.removeMessage', { name: row.name }), () => { void extensions.removeSkill(effectiveScope, row).catch(() => undefined); })}>{t('common:actions.remove')}</Button> : null}
              </View>
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.skills)} render={(row) => <List.Item title={row.name} description={row.description || row.path} />} /> : null}
        </View>
      ) : null}

      {tab === 'commands' ? (
        <View style={styles.section}>
          <Text variant="titleMedium">{editingCommand ? t('settings:extensions.commands.editTitle', { name: editingCommand }) : t('settings:extensions.commands.addTitle')}</Text>
          <TextInput testID="settings-extension-command-name" mode="outlined" label={t('settings:extensions.commands.name')} value={commandName} onChangeText={setCommandName} autoCapitalize="none" autoCorrect={false} />
          <TextInput testID="settings-extension-command-description" mode="outlined" label={t('settings:extensions.commands.descriptionLabel')} value={commandDescription} onChangeText={setCommandDescription} />
          <TextInput testID="settings-extension-command-template" mode="outlined" multiline numberOfLines={5} label={t('settings:extensions.commands.template')} value={commandTemplate} onChangeText={setCommandTemplate} />
          <HelperText type="info">{t('settings:extensions.commands.templateHint')}</HelperText>
          <View style={styles.actions}><Button testID="settings-extension-command-save" mode="contained" disabled={busy || !data?.safety.writable} onPress={submitCommand}>{t('common:actions.save')}</Button>{editingCommand ? <Button disabled={busy} onPress={() => { setEditingCommand(undefined); setCommandName(''); setCommandDescription(''); setCommandTemplate(''); }}>{t('common:actions.cancel')}</Button> : null}</View>
          {data?.items.commands.length === 0 ? <HelperText type="info">{t('settings:extensions.commands.empty')}</HelperText> : null}
          {data?.items.commands.map((row) => (
            <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>
              <List.Item title={`/${row.name}`} description={row.description || row.template} />
              <View style={styles.actions}>
                {row.editable ? <Button compact disabled={busy} onPress={() => { setEditingCommand(row.name); setCommandName(row.name); setCommandDescription(row.description || ''); setCommandTemplate(row.template || ''); }}>{t('common:actions.edit')}</Button> : null}
                {row.editable ? <Button testID={`settings-extension-command-remove-${row.name.replace(/[^a-z0-9]+/gi, '-')}`} compact textColor={palette.danger} disabled={busy} onPress={() => remove(t('settings:extensions.removeTitle'), t('settings:extensions.commands.removeMessage', { name: row.name }), () => { void extensions.removeCommand(effectiveScope, row.name).catch(() => undefined); })}>{t('common:actions.remove')}</Button> : null}
              </View>
            </View>
          ))}
          {data ? <ReadOnlyRows title={t('settings:extensions.shared')} rows={visibleSharedRows(data.shared.commands)} render={(row) => <List.Item title={`/${row.name}`} description={row.description || t('settings:extensions.shared')} />} /> : null}
        </View>
      ) : null}
      {authentication.dialog}
      {extensions.busy ? <HelperText type="info">{t('settings:extensions.saving')}</HelperText> : null}
      {!data && !extensions.isRefreshing ? <HelperText type="info">{t('settings:extensions.unavailable')}</HelperText> : null}
    </View>
  );
}

function describeMcp(config: Record<string, unknown>) {
  if (config.type === 'remote') return String(config.url || '');
  return Array.isArray(config.command) ? config.command.join(' ') : '';
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontWeight: '600' },
  card: { borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
  loading: { marginVertical: 24 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { gap: 10 },
  row: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 4, paddingBottom: 6 },
  shared: { gap: 6, marginTop: 8 },
});
