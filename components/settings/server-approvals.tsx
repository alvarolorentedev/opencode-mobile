import { SettingButton as Button, SettingSwitchRow } from './sections/setting-rows';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useApprovals, useChat, useConnection, usePreferences } from '@/providers/opencode-contexts';
import { useWorkspaces } from '@/providers/workspace-context';

import { useSettingsTarget } from './settings-panel';
import { PermissionRequestCard } from '@/components/chat/cards/permission-request-card';
import { PermissionsSection } from '@/components/settings/sections/permissions-section';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { usePalette } from '@/hooks/use-palette';
export function ServerApprovals() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { approvals } = useApprovals();
  const { setAutoApprove } = useChat();
  const { chatPreferences } = usePreferences();
  const { settings, connection } = useConnection();
  const registry = useWorkspaces();
  const multipleServers = registry.connections.length > 1;
  const target = useSettingsTarget();
  const [section, setSection] = useState<'pending' | 'saved'>(target?.group === 'saved' ? 'saved' : 'pending');
  const [error, setError] = useState<string>();
  const { refreshSavedPermissions } = approvals;
  useEffect(() => { void refreshSavedPermissions(); }, [refreshSavedPermissions]);
  const id = getConnectionUiScope(settings);
  const requests = new Map<string, { key: string; projectPath: string; runtime: typeof registry.snapshots[string]; request: typeof registry.snapshots[string]['pendingPermissions'][string][number] }>();
  const questions = new Map<string, { sessionId: string; projectPath: string; title?: string }>();
  for (const [key, runtime] of Object.entries(registry.snapshots)) {
    if ((JSON.parse(key) as string[])[0] !== id) continue;
    const path = runtime.values.projectsValue.activeProjectPath ?? '';
    const sessionPath = (sessionId: string) => runtime.catalogSessions.find((session) => session.id === sessionId)?.directory ?? path;
    for (const request of Object.values(runtime.pendingPermissions).flat()) requests.set(request.id, { key, runtime, projectPath: sessionPath(request.sessionID), request });
    for (const request of Object.values(runtime.pendingQuestions).flat()) questions.set(request.id, { sessionId: request.sessionID, projectPath: sessionPath(request.sessionID), title: request.title });
  }
  return <View style={{ gap: 14 }}>
    <SettingSwitchRow title={t('chat:composer.autoApproveEnabled')} description={multipleServers ? t('common:servers.onlyThisServer') : ''}
      palette={palette} value={chatPreferences.autoApprove} disabled={connection.status !== 'connected'}
      onValueChange={(value) => void setAutoApprove(value).catch((reason) => setError(String(reason)))} />
    <View style={{ flexDirection: 'row', gap: 8 }}><Button mode={section === 'pending' ? 'contained-tonal' : 'text'} onPress={() => setSection('pending')}>{t('common:servers.pending', { count: requests.size + questions.size })}</Button>
      <Button mode={section === 'saved' ? 'contained-tonal' : 'text'} onPress={() => setSection('saved')}>{t('common:servers.savedRules', { count: approvals.savedPermissions.length })}</Button></View>
    {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
    {section === 'saved' ? <PermissionsSection palette={palette} rules={approvals.savedPermissions} serverName={registry.connections.find((entry) => entry.id === id)?.name}
      onRefresh={() => void approvals.refreshSavedPermissions()} onRemove={(rule) => void approvals.removeSavedPermission(rule).catch((reason) => setError(String(reason)))} /> : <>
      {[...requests.values()].map(({ key, runtime, projectPath, request }) => <View key={`${key}:${request.id}`} style={{ gap: 8 }}>
        <Text>{multipleServers ? `${settings.serverUrl} / ` : ''}{projectPath}</Text>
        <PermissionRequestCard request={request} sourceTitle={runtime.values.sessionLibraryValue.sessions.find((session) => session.id === request.sessionID)?.title}
          onReply={async (reply) => { try { if (!registry.isEnabled(id)) throw new Error('Connect this server before replying.'); await runtime.values.chatValue.replyToPermission(request.id, reply); } catch (reason) { setError(String(reason)); throw reason; } }} />
      </View>)}
      {[...questions.entries()].map(([key, request]) => <Button key={key} icon="message-question-outline" onPress={() => void registry.navigate({ connectionId: id, projectPath: request.projectPath, sessionId: request.sessionId }).then(() => router.push('/')).catch((reason) => setError(String(reason)))}>{request.title ?? t('chat:cards.assistantQuestion')}</Button>)}
      {!requests.size && !questions.size ? <Text>{t('settings:permissions.empty')}</Text> : null}
    </>}
  </View>;
}
