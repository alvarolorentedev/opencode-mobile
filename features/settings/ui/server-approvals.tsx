import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { Icon } from '@/shared/ui/icon';
import { SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useApprovals, useServerPendingInteractions } from '@/features/sessions/context';
import { useChat } from '@/features/chat/context';
import { useConnection } from '@/features/connections/context';
import { useWorkspacePreferences, useWorkspaces } from '@/runtime/workspace';

import { useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { PermissionRequestCard , PermissionsSection } from '@/features/sessions/index';
import { usePalette } from '@/shared/ui/theme/use-palette';
export function ServerApprovals({ workspace }: { workspace: WorkspaceTarget }) {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { approvals } = useApprovals(workspace);
  const { setAutoApprove } = useChat(workspace);
  const { chatPreferences } = useWorkspacePreferences(workspace);
  const { settings, connection } = useConnection(workspace);
  const registry = useWorkspaces();
  const multipleServers = registry.connections.length > 1;
  const target = useSettingsTarget();
  const [section, setSection] = useState<'pending' | 'saved'>(target?.group === 'saved' ? 'saved' : 'pending');
  const [error, setError] = useState<string>();
  const { refreshSavedPermissions } = approvals;
  useEffect(() => { void refreshSavedPermissions(); }, [refreshSavedPermissions]);
  const id = workspace.connectionId;
  const { permissions, questions } = useServerPendingInteractions(id);
  return <View className={cn("gap-3.5")}>
    <SettingSwitchRow title={t('chat:composer.autoApproveEnabled')} description={multipleServers ? t('common:servers.onlyThisServer') : ''}
      palette={palette} value={chatPreferences.autoApprove} disabled={connection.status !== 'connected'}
      onValueChange={(value) => void setAutoApprove(value).catch((reason) => setError(String(reason)))} />
    <View className={cn("flex-row gap-2")}><Button onPress={() => setSection('pending')} variant={section === 'pending' ? 'secondary' : 'ghost'}><Text>{t('common:servers.pending', { count: permissions.size + questions.size })}</Text></Button>
      <Button onPress={() => setSection('saved')} variant={section === 'saved' ? 'secondary' : 'ghost'}><Text>{t('common:servers.savedRules', { count: approvals.savedPermissions.length })}</Text></Button></View>
    {error ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{error}</Text> : null}
    {section === 'saved' ? <PermissionsSection palette={palette} rules={approvals.savedPermissions} serverName={registry.connections.find((entry) => entry.id === id)?.name}
      onRemove={(rule) => void approvals.removeSavedPermission(rule).catch((reason) => setError(String(reason)))} /> : <>
      {[...permissions.values()].map(({ projectPath, request, sourceTitle, reply }) => <View key={request.id} className={cn("gap-2")}>
        <Text>{multipleServers ? `${settings.serverUrl} / ` : ''}{projectPath}</Text>
        <PermissionRequestCard request={request} sourceTitle={sourceTitle}
          onReply={async (value) => { try { if (!registry.isEnabled(id)) throw new Error('Connect this server before replying.'); await reply(value); } catch (reason) { setError(String(reason)); throw reason; } }} />
      </View>)}
      {[...questions.entries()].map(([key, request]) => <Button key={key} onPress={() => void registry.navigate({ connectionId: id, projectPath: request.projectPath, sessionId: request.sessionId }).then(() => router.push('/')).catch((reason) => setError(String(reason)))} variant={"ghost"}><Icon name={"message-question-outline"} size={20} /><Text>{request.title ?? t('chat:cards.assistantQuestion')}</Text></Button>)}
      {!permissions.size && !questions.size ? <Text>{t('settings:permissions.empty')}</Text> : null}
    </>}
  </View>;
}
