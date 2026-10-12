import { useMcpAuthentication } from './use-mcp-authentication';
import type { McpContextValue } from '@/providers/opencode-provider-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { Button, Chip, HelperText, List, SegmentedButtons, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';

import { Colors } from '@/constants/theme';
import type { Config, McpLocalConfig, McpRemoteConfig, McpStatus } from '@/lib/opencode/types';

type Palette = typeof Colors.light;
type McpConfig = NonNullable<Config['mcp']>[string];

export function McpSection({
  configs,
  mcpStatuses,
  onAdd,
  onConnect,
  onDisconnect,
  onRefresh,
  onSetEnabled,
  mcpOAuth,
  persistentConfigAvailable = true,
  oauthAvailable = true,
  requiresIntegrationId = false,
  palette,
}: {
  configs?: Config['mcp'];
  mcpStatuses: Record<string, McpStatus>;
  onAdd: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  onConnect: (name: string) => Promise<void>;
  onDisconnect: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSetEnabled: (name: string, enabled: boolean) => Promise<void>;
  mcpOAuth: McpContextValue['mcpOAuth'];
  persistentConfigAvailable?: boolean;
  oauthAvailable?: boolean;
  requiresIntegrationId?: boolean;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const [addType, setAddType] = useState<'local' | 'remote'>('local');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const authentication = useMcpAuthentication(mcpOAuth, palette);
  const names = Array.from(new Set([...Object.keys(configs || {}), ...Object.keys(mcpStatuses)])).sort();

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(undefined);
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('settings:mcp.couldNotUpdate'));
    } finally {
      setBusy(undefined);
    }
  }

  function describeConfig(config?: McpConfig) {
    if (!config || !('type' in config)) return t('settings:mcp.configurationUnavailable');
    return config.type === 'local' ? config.command.join(' ') : config.url;
  }

  const trimmedName = name.trim();
  const trimmedTarget = target.trim();

  function localCommand() {
    const command: unknown = JSON.parse(trimmedTarget);
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string' || !part)) {
      throw new Error(t('settings:mcp.invalidCommand'));
    }
    return command as string[];
  }

  return (
    <View style={styles.section}>
        <View style={styles.header}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:mcp.title')}</Text>
          <Button compact loading={busy === 'refresh'} onPress={() => void run('refresh', onRefresh)}>{t('common:actions.refresh')}</Button>
        </View>
        <SegmentedButtons
          value={addType}
          onValueChange={(value) => { setAddType(value as 'local' | 'remote'); setTarget(''); }}
          buttons={[{ value: 'local', label: t('settings:mcp.local') }, { value: 'remote', label: t('settings:mcp.remote') }]}
        />
        <TextInput testID="settings-mcp-name" mode="outlined" label={t('settings:mcp.serverName')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} />
        <TextInput
          testID="settings-mcp-target"
          mode="outlined"
          label={addType === 'local' ? t('settings:mcp.commandArguments') : t('settings:mcp.url')}
          placeholder={addType === 'local' ? '["npx","@modelcontextprotocol/server"]' : 'https://example.com/mcp'}
          value={target}
          onChangeText={setTarget}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          testID="settings-mcp-add"
          mode="contained"
          disabled={!trimmedName || !trimmedTarget || Boolean(busy)}
          loading={busy === 'add'}
          onPress={() => void run('add', async () => {
            await onAdd(trimmedName, addType === 'local'
              ? { type: 'local', command: localCommand() }
              : { type: 'remote', url: trimmedTarget });
            setName('');
            setTarget('');
          })}>
          {addType === 'local' ? t('settings:mcp.addLocalServer') : t('settings:mcp.addRemoteServer')}
        </Button>

        {names.length === 0 ? <HelperText type="info">{t('settings:mcp.noServers')}</HelperText> : null}
        {names.map((serverName) => {
          const config = configs?.[serverName];
          const status = mcpStatuses[serverName];
          const enabled = config?.enabled !== false;
          const isRemote = config && 'type' in config && config.type === 'remote';
          const actionKey = `action:${serverName}`;

          return (
            <View key={serverName} style={[styles.server, { backgroundColor: palette.background, borderColor: palette.border }]}>
              <List.Item
                title={serverName}
                description={describeConfig(config)}
                titleStyle={{ color: palette.text }}
                descriptionStyle={{ color: palette.muted }}
                right={() => <Chip compact>{status?.status || (enabled ? t('settings:mcp.statusConfigured') : t('settings:mcp.statusDisabled'))}</Chip>}
              />
              {status?.status === 'failed' || status?.status === 'needs_client_registration' ? (
                <HelperText type="error">{status.error}</HelperText>
              ) : null}
              <View style={styles.actions}>
                {config && persistentConfigAvailable ? (
                  <View style={styles.enabledControl}>
                    <Text variant="labelMedium">{t('common:labels.enabled')}</Text>
                    <Switch
                      value={enabled}
                      disabled={Boolean(busy)}
                      onValueChange={(value) => void run(actionKey, () => onSetEnabled(serverName, value))}
                    />
                  </View>
                ) : null}
                <Button
                  compact
                  disabled={!enabled || Boolean(busy)}
                  loading={busy === actionKey}
                  onPress={() => void run(actionKey, () => status?.status === 'connected' ? onDisconnect(serverName) : onConnect(serverName))}>
                  {status?.status === 'connected' ? t('common:actions.disconnect') : t('common:actions.connect')}
                </Button>
                {oauthAvailable && (requiresIntegrationId ? Boolean((status as { integrationID?: string } | undefined)?.integrationID) : isRemote) && status?.status === 'needs_auth' ? (
                  <Button compact disabled={Boolean(busy)} onPress={() => void run(actionKey, () => authentication.open(serverName))}>{t('settings:mcp.oauth')}</Button>
                ) : null}
              </View>

            </View>
          );
        })}
        {authentication.dialog}
        {error ? <HelperText type="error">{error}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16 },
  section: { gap: 14, paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  server: { borderRadius: 14, borderWidth: 1, padding: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  enabledControl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oauth: { gap: 8, padding: 8 },
});
