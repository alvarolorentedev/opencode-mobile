import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from 'react-i18next';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
import { useWorkspaces } from '@/providers/workspace-context';
import type { WorkspaceTarget } from '@/providers/workspace-types';
export function NewTerminalSheet({ target: initial, onClose, onCreate }: { target?: WorkspaceTarget; onClose: () => void; onCreate: (target: WorkspaceTarget) => Promise<unknown> }) {
  const { t } = useTranslation();
  const registry = useWorkspaces();
  const { groups } = useWorkspaceProjects();
  const multipleServers = groups.length > 1;
  const [target, setTarget] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const server = groups.find((entry) => entry.id === target?.connectionId);
  const chat = registry.focus && registry.valuesFor(registry.focus);
  const chatServer = groups.find((entry) => entry.id === registry.focus?.connectionId)?.name;
  return <OverlaySheet visible title={t('terminal:console.new')} testID="new-terminal-sheet" fitContent onClose={() => { if (!busy) onClose(); }}>
    <Text>{t('common:servers.newTerminalHint')}</Text>
    {multipleServers ? <WorkspaceSelect title={t('common:servers.server')} value={target?.connectionId} testID="terminal-server-picker" disabled={busy}
      options={groups.map((entry) => ({ value: entry.id, label: entry.name, description: t(`common:servers.status.${entry.status}`) }))}
      onChange={(connectionId) => setTarget({ connectionId, projectPath: '' })} /> : null}
    <WorkspaceSelect title={t('common:servers.projectContext')} value={target?.projectPath} testID="terminal-project-picker" disabled={busy || !server}
      options={server?.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path })) ?? []}
      onChange={(projectPath) => { if (target) setTarget({ ...target, projectPath }); }} />
    <Text  variant="label">{t('common:servers.workingDirectory')}</Text><Text style={{ fontFamily: 'monospace' }}>{target?.projectPath || '—'}</Text>
    <Text  variant="label">{t('common:servers.chatUnchanged', { name: `${multipleServers ? `${chatServer} / ` : ''}${chat?.projectsValue.activeProject?.label ?? ''}` })}</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <View className={cn("flex-row justify-end gap-2")}><Button disabled={busy} onPress={onClose} variant={"ghost"}><Text>{t('common:actions.cancel')}</Text></Button>
      <Button testID="terminal-create-confirm" disabled={busy || !target?.projectPath || server?.status !== 'connected'} onPress={() => {
        if (!target) return; setBusy(true); setError(undefined);
        void onCreate(target).then(onClose).catch((reason) => setError(String(reason))).finally(() => setBusy(false));
      }} variant={"default"}>{busy ? <Spinner size="small" /> : null}<Text>{t('terminal:console.create')}</Text></Button></View>
  </OverlaySheet>;
}
