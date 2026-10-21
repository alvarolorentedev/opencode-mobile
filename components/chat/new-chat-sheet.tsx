import { useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
import { useWorkspaces } from '@/providers/workspace-context';
import type { WorkspaceTarget } from '@/providers/workspace-types';

export function NewChatSheet({ target: initial, onClose, onCreate }: { target?: WorkspaceTarget; onClose: () => void; onCreate: (target: WorkspaceTarget) => Promise<unknown> }) {
  const { t } = useTranslation();
  const registry = useWorkspaces();
  const { groups } = useWorkspaceProjects();
  const multipleServers = registry.connections.length > 1;
  const [target, setTarget] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const server = groups.find((entry) => entry.id === target?.connectionId);
  return <OverlaySheet visible title={t('chat:newChat.title')} testID="new-chat-sheet" fitContent onClose={() => { if (!busy) onClose(); }}>
    <Text>{t('chat:newChat.hint')}</Text>
    {multipleServers ? <WorkspaceSelect title={t('common:servers.server')} value={target?.connectionId} testID="new-chat-server-picker" disabled={busy}
      options={groups.filter((entry) => entry.enabled).map((entry) => ({ value: entry.id, label: entry.name, description: t(`common:servers.status.${entry.status}`) }))}
      onChange={(connectionId) => setTarget({ connectionId, projectPath: '' })} /> : null}
    <WorkspaceSelect title={t('common:servers.projectContext')} value={target?.projectPath} testID="new-chat-project-picker" disabled={busy || !server}
      options={server?.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path })) ?? []}
      onChange={(projectPath) => { if (target) setTarget({ ...target, projectPath }); }} />
    <Text variant="labelMedium">{t('common:servers.workingDirectory')}</Text><Text style={{ fontFamily: 'monospace' }}>{target?.projectPath || '—'}</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Button disabled={busy} onPress={onClose}>{t('common:actions.cancel')}</Button>
      <Button testID="new-chat-confirm" mode="contained" loading={busy} disabled={busy || !target?.projectPath || server?.status !== 'connected'} onPress={() => {
        if (!target) return; setBusy(true); setError(undefined);
        void onCreate(target).then(onClose).catch((reason) => setError(String(reason))).finally(() => setBusy(false));
      }}>{t('chat:newChat.create')}</Button></View>
  </OverlaySheet>;
}
