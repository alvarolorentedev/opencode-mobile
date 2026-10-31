import { cn } from '@/lib/utils';
import { useForm, useController } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { mcpSchema, type McpDraft } from './forms/extension-schemas';
import { SettingField } from '@/components/settings/sections/setting-rows';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FieldDescription } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ListRow } from '@/components/ui/list-row';
import { Badge } from '@/components/ui/badge';

import { useMcpAuthentication } from './use-mcp-authentication';
import type { McpContextValue } from '@/providers/opencode-provider-types';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';




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
  mcpOAuth,
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
  mcpOAuth: McpContextValue['mcpOAuth'];
  oauthAvailable?: boolean;
  requiresIntegrationId?: boolean;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const form = useForm<McpDraft>({ resolver: zodResolver(mcpSchema), defaultValues: { name: '', target: '', type: 'local' } });
  const { field: { value: addType, onChange: setAddType } } = useController({ control: form.control, name: 'type' });
  const { field: { value: name, onChange: setName, ref: nameRef, onBlur: nameBlur } } = useController({ control: form.control, name: 'name' });
  const { field: { value: target, onChange: setTarget, ref: targetRef, onBlur: targetBlur } } = useController({ control: form.control, name: 'target' });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const authentication = useMcpAuthentication(mcpOAuth, palette);
  // MCP status is lazy now: refresh when this settings section opens.
  useEffect(() => { void onRefresh().catch(() => undefined); }, [onRefresh]);
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
    <View className={cn(stylesClasses.section)}>
        <Text className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:mcp.title')}</Text>
        <ToggleGroup type="single" value={addType} onValueChange={(value) => { if (!value) return; setAddType(value as 'local' | 'remote'); setTarget(''); }} className="flex-row flex-wrap">{([{ value: 'local', label: t('settings:mcp.local') }, { value: 'remote', label: t('settings:mcp.remote') }]).map((option) => <ToggleGroupItem key={option.value} value={option.value} disabled={'disabled' in option && option.disabled === true}><Text>{option.label}</Text></ToggleGroupItem>)}</ToggleGroup>
        <SettingField testID="settings-mcp-name" label={t('settings:mcp.serverName')} ref={nameRef} onBlur={nameBlur} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false}></SettingField>
        <SettingField testID="settings-mcp-target" label={addType === 'local' ? t('settings:mcp.commandArguments') : t('settings:mcp.url')} placeholder={addType === 'local' ? '["npx","@modelcontextprotocol/server"]' : 'https://example.com/mcp'} ref={targetRef} onBlur={targetBlur} value={target} onChangeText={setTarget} autoCapitalize="none" autoCorrect={false}></SettingField>
        <Button testID="settings-mcp-add" disabled={!trimmedName || !trimmedTarget || Boolean(busy)} onPress={() => void run('add', async () => { if (!await form.trigger()) return;
            await onAdd(trimmedName, addType === 'local'
              ? { type: 'local', command: localCommand() }
              : { type: 'remote', url: trimmedTarget });
            setName('');
            setTarget('');
          })} variant="default">{busy === 'add' ? <Spinner size="small" /> : null}<Text>{addType === 'local' ? t('settings:mcp.addLocalServer') : t('settings:mcp.addRemoteServer')}</Text></Button>

        {names.length === 0 ? <FieldDescription  invalid={false}>{t('settings:mcp.noServers')}</FieldDescription> : null}
        {names.map((serverName) => {
          const config = configs?.[serverName];
          const status = mcpStatuses[serverName];
          const enabled = config?.enabled !== false;
          const isRemote = config && 'type' in config && config.type === 'remote';
          const actionKey = `action:${serverName}`;

          return (
            <View key={serverName} className={cn(stylesClasses.server, "bg-background border-border")}>
              <ListRow title={serverName} description={describeConfig(config)} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Badge  variant="secondary"><Text>{status?.status || (enabled ? t('settings:mcp.statusConfigured') : t('settings:mcp.statusDisabled'))}</Text></Badge>}></ListRow>
              {status?.status === 'failed' || status?.status === 'needs_client_registration' ? (
                <FieldDescription  invalid={true}>{status.error}</FieldDescription>
              ) : null}
              <View className={cn(stylesClasses.actions)}>
                <Button disabled={!enabled || Boolean(busy)} onPress={() => void run(actionKey, () => status?.status === 'connected' ? onDisconnect(serverName) : onConnect(serverName))} variant="ghost">{busy === actionKey ? <Spinner size="small" /> : null}<Text>{status?.status === 'connected' ? t('common:actions.disconnect') : t('common:actions.connect')}</Text></Button>
                {oauthAvailable && (requiresIntegrationId ? Boolean((status as { integrationID?: string } | undefined)?.integrationID) : isRemote) && status?.status === 'needs_auth' ? (
                  <Button disabled={Boolean(busy)} onPress={() => void run(actionKey, () => authentication.open(serverName))} variant="ghost"><Text>{t('settings:mcp.oauth')}</Text></Button>
                ) : null}
              </View>

            </View>
          );
        })}
        {authentication.dialog}
        {Object.values(form.formState.errors).map((error, index) => error?.message ? <FieldDescription key={index} invalid>{t(error.message)}</FieldDescription> : null)}
      {error ? <FieldDescription  invalid={true}>{error}</FieldDescription> : null}
    </View>
  );
}



const stylesClasses = {
  "section": "gap-3.5 px-4 pb-4",
  "title": "font-semibold",
  "server": "rounded-[14px] border p-2",
  "actions": "flex-row flex-wrap items-center justify-end gap-1"
} as const;
