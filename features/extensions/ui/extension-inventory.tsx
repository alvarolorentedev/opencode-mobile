import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExtensions, useMcp } from '@/features/extensions/context';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { Badge } from '@/shared/ui/badge';
import { ListRow } from '@/shared/ui/list-row';
import { FieldDescription } from '@/shared/ui/text-field';
import { visibleSharedRows } from '@/shared/presentation/extension-rows';
import type { ExtensionAgentRow, ExtensionCommandRow, ExtensionMcpRow, ExtensionScope, ExtensionSkillRow, ExtensionSnapshot } from '@/shared/protocol/opencode/extensions/types';

export type ExtensionTab = 'mcp' | 'plugins' | 'agents' | 'skills' | 'commands';
export type ExtensionSelection = { type: 'agents'; row?: ExtensionAgentRow; readOnly?: boolean } | { type: 'commands'; row?: ExtensionCommandRow } | { type: 'skills'; row?: ExtensionSkillRow } | { type: 'mcp'; row?: ExtensionMcpRow } | { type: 'plugins' };
const rowID = (value: string) => value.replace(/[^a-z0-9]+/gi, '-');

export function ExtensionInventory({ tab, data, scope, busy, onEdit, onRemove, runMcp, authenticate }: {
  tab: ExtensionTab; data: ExtensionSnapshot[ExtensionScope]; scope: ExtensionScope; busy: boolean;
  onEdit: (selection: ExtensionSelection) => void; onRemove: (message: string, action: () => Promise<void>) => void;
  runMcp: (action: () => Promise<void>) => void; authenticate: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const mcp = useMcp();
  const shared = visibleSharedRows<(typeof data.shared)[ExtensionTab][number]>(data.shared[tab]);
  const removeButton = (id: string, name: string, group: ExtensionTab, disabled: boolean, action: () => Promise<void>) => <Button testID={`settings-extension-${id}`} variant="ghost" disabled={busy || disabled} onPress={() => onRemove(t(`settings:extensions.${group}.removeMessage`, { name }), action)}><Text className="text-destructive">{t('common:actions.remove')}</Text></Button>;
  const editButton = (id: string, selection: ExtensionSelection) => <Button testID={`settings-extension-${id}`} variant="ghost" disabled={busy} onPress={() => onEdit(selection)}><Text>{t('common:actions.edit')}</Text></Button>;
  return <View className="gap-3">
    {!data.items[tab].length ? <FieldDescription>{t(`settings:extensions.${tab}.empty`)}</FieldDescription> : null}
    {tab === 'mcp' ? data.items.mcp.map((row) => {
      const status = row.status?.status;
      return <View key={row.key} className="border-b border-border pb-2">
        <ListRow title={row.name} description={row.config?.type === 'remote' ? String(row.config.url || '') : row.config && 'command' in row.config && Array.isArray(row.config.command) ? row.config.command.join(' ') : t('settings:extensions.mcp.runtime')}
          right={() => <Badge variant="secondary"><Text>{status ? t(`settings:extensions.editor.mcpStatus.${status}`) : t('settings:extensions.mcp.configured')}</Text></Badge>} />
        {row.status && 'error' in row.status && row.status.error ? <FieldDescription invalid>{row.status.error}</FieldDescription> : null}
        <View className="flex-row flex-wrap justify-end gap-1">
          {row.editable && row.config ? editButton(`mcp-edit-${rowID(row.name)}`, { type: 'mcp', row }) : null}
          <Button variant="ghost" disabled={busy} onPress={() => runMcp(() => status === 'connected' ? mcp.disconnectMcpServer(row.name) : mcp.connectMcpServer(row.name))}><Text>{t(status === 'connected' ? 'common:actions.disconnect' : 'common:actions.connect')}</Text></Button>
          {status === 'needs_auth' && row.status && 'integrationID' in row.status && row.status.integrationID ? <Button variant="ghost" disabled={busy} onPress={() => authenticate(row.name)}><Text>{t('settings:mcp.oauth')}</Text></Button> : null}
          {row.removeMode !== 'none' ? removeButton(`mcp-remove-${rowID(row.name)}`, row.name, 'mcp', row.removeMode === 'config' && !row.editable, () => extensions.removeMcp(scope, row.name)) : null}
        </View>
      </View>;
    }) : null}
    {tab === 'plugins' ? data.items.plugins.map((row) => <View key={row.key} className="border-b border-border pb-2">
      <ListRow title={row.label} description={[row.version, row.status, row.outdated ? t('settings:extensions.plugins.outdated') : undefined].filter(Boolean).join(' · ')} right={() => <Badge variant="secondary"><Text>{t(`settings:extensions.source.${row.source}`)}</Text></Badge>} />
      {row.target ? removeButton(`plugin-remove-${rowID(row.label)}`, row.label, 'plugins', !row.editable, () => extensions.removePlugin(scope, row.target!)) : null}
    </View>) : null}
    {tab === 'agents' ? data.items.agents.map((row) => <View key={row.key} className="border-b border-border pb-2">
      <ListRow title={row.name} description={row.shadowedBy ? t('settings:extensions.origin.shadowed') : row.readOnlyReason || row.description || row.path} right={() => <Badge variant="secondary"><Text>{t(`settings:extensions.origin.${row.origin}`)}</Text></Badge>} />
      <View className="flex-row flex-wrap justify-end gap-1">
        <Button testID={`settings-extension-agent-view-${rowID(row.id)}`} variant="ghost" disabled={busy} onPress={() => onEdit({ type: 'agents', row, readOnly: true })}><Text>{t('settings:extensions.agents.view')}</Text></Button>
        {row.editable ? editButton(`agent-edit-${rowID(row.id)}`, { type: 'agents', row }) : null}
        {row.removable ? removeButton(`agent-remove-${rowID(row.id)}`, row.name, 'agents', false, () => extensions.removeAgent(scope, row)) : null}
      </View>
    </View>) : null}
    {tab === 'skills' ? data.items.skills.map((row) => <View key={row.key} className="border-b border-border pb-2">
      <ListRow title={row.name || row.id} description={row.description || row.path} right={() => <Badge variant="secondary"><Text>{row.id}</Text></Badge>} />
      <View className="flex-row flex-wrap justify-end gap-1">{row.editable ? editButton(`skill-edit-${rowID(row.id)}`, { type: 'skills', row }) : null}
        {row.removable ? removeButton(`skill-remove-${rowID(row.id)}`, row.name, 'skills', false, () => extensions.removeSkill(scope, row)) : null}</View>
    </View>) : null}
    {tab === 'commands' ? data.items.commands.map((row) => <View key={row.key} className="border-b border-border pb-2">
      <ListRow title={`/${row.name}`} description={row.shadowedBy ? t('settings:extensions.origin.shadowed') : row.readOnlyReason || row.description || row.template} right={() => <Badge variant="secondary"><Text>{t(`settings:extensions.origin.${row.origin}`)}</Text></Badge>} />
      <View className="flex-row flex-wrap justify-end gap-1">{row.editable ? editButton(`command-edit-${rowID(row.name)}`, { type: 'commands', row }) : null}
        {row.removable ? removeButton(`command-remove-${rowID(row.name)}`, row.name, 'commands', false, () => extensions.removeCommand(scope, row)) : null}</View>
    </View>) : null}
    {shared.length ? <View className="gap-2 mt-3"><Text variant="description">{t('settings:extensions.shared')}</Text>
      {shared.map((row) => <View key={row.key} className="border-b border-border"><ListRow title={'label' in row ? row.label : 'name' in row ? row.name : ''} description={'description' in row ? row.description : t(`settings:extensions.source.${row.source}`)} />
        {tab === 'agents' && 'permissionsFormat' in row ? <Button variant="ghost" onPress={() => onEdit({ type: 'agents', row, readOnly: true })}><Text>{t('settings:extensions.agents.view')}</Text></Button> : null}
      </View>)}<FieldDescription>{t('settings:extensions.sharedHint')}</FieldDescription></View> : null}
  </View>;
}
