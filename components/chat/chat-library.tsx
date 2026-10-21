import { LegacyChatLibrary } from '@/components/chat/chat-library-v1';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { SwipeRow } from '@/components/ui/swipe-row';
import { TextInput } from '@/components/ui/text-input';
import { ProjectPicker, ProjectPickerButton } from '@/components/ui/project-picker';
import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatRelativeTime } from '@/lib/opencode/format';
import { confirmAction } from '@/lib/confirm-action';
import { usePreferences, useProjects, useConnection } from '@/providers/opencode-contexts';
import { useWorkspaces } from '@/providers/workspace-context';
import { useWorkspaceLibrary } from '@/providers/use-workspace-library';
import { sessionKey, workspaceKey } from '@/providers/workspace-types';
import type { LibrarySession } from '@/providers/workspace-library';

export function ChatLibrary({ visible, onClose, onNewChat }: { visible: boolean; onClose: () => void; onNewChat: () => void }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { activeProject } = useProjects();
  const { serverCapabilities } = useConnection();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const registry = useWorkspaces();
  const multipleServers = registry.connections.length > 1;
  const library = useWorkspaceLibrary();
  const [projectVisible, setProjectVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [server, setServer] = useState('');
  const [projectFilter, setProject] = useState('');
  const project = library.sessions.some((row) => workspaceKey(row) === projectFilter) ? projectFilter : '';
  const [renaming, setRenaming] = useState<LibrarySession>();
  const [title, setTitle] = useState('');
  const [busy, setBusyId] = useState<string>();
  const operationRef = useRef<{ id: string } | undefined>(undefined);
  const queuedOpenRef = useRef<{ id: string; action: () => Promise<unknown>; onSuccess: () => void } | undefined>(undefined);
  useEffect(() => () => { operationRef.current = undefined; queuedOpenRef.current = undefined; }, [visible]);
  const [error, setError] = useState<string>();
  const { refresh } = library;
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20000);
    return () => clearInterval(timer);
  }, [visible, refresh]);
  const close = () => { operationRef.current = undefined; queuedOpenRef.current = undefined; setBusyId(undefined); setProjectVisible(false); setRenaming(undefined); setError(undefined); onClose(); };
  async function run(id: string, action: () => Promise<unknown>, onSuccess?: () => void) {
    if (operationRef.current) {
      // Ignore duplicate taps; a different opening waits and the latest wins.
      if (onSuccess && operationRef.current.id !== id) queuedOpenRef.current = { id, action, onSuccess };
      return;
    }
    const operation = { id };
    operationRef.current = operation;
    setBusyId(id); setError(undefined);
    try {
      await action();
      if (operationRef.current === operation && !queuedOpenRef.current) onSuccess?.();
    } catch (reason) {
      if (operationRef.current === operation && !queuedOpenRef.current) setError(reason instanceof Error ? reason.message : t('chat:library.couldNotUpdate'));
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined; setBusyId(undefined);
        const queued = queuedOpenRef.current;
        queuedOpenRef.current = undefined;
        if (queued) void run(queued.id, queued.action, queued.onSuccess);
      }
    }
  }
  const needle = query.trim().toLowerCase();
  const rows = library.sessions.filter((row) => (!multipleServers || !server || row.connectionId === server) && (!project || workspaceKey(row) === project)
    && (!chatPreferences.hideSubagentChats || !row.session.parentID)
    && `${row.session.title} ${row.preview ?? ''} ${row.serverName} ${row.projectPath}`.toLowerCase().includes(needle));
  const projectOptions = [...new Map(library.sessions.filter((row) => !multipleServers || !server || row.connectionId === server)
    .map((row) => [workspaceKey(row), { value: workspaceKey(row), label: row.projectPath.split('/').pop() || row.projectPath, description: row.serverName }])).values()];
  const focusedServer = registry.connections.find((entry) => entry.id === registry.focus?.connectionId)?.name;
  function renderRow(row: LibrarySession) {
    const key = sessionKey(row);
    const label = row.session.title || t('chat:library.untitledChat');
    const running = row.status.type !== 'idle';
    return <View style={{ paddingBottom: 8 }}>
      <SwipeRow title={label} actions={[
        { label: t('chat:library.rename'), icon: 'pencil-outline', onPress: () => { setRenaming(row); setTitle(label); } },
        { label: t(row.favorite ? 'chat:library.unfavorite' : 'chat:library.favorite'), icon: row.favorite ? 'star-off-outline' : 'star-outline', onPress: () => void run(key, () => library.manage(row, 'favorite', row.session.title)) },
        { label: t('common:actions.delete'), icon: 'delete-outline', onPress: () => confirmAction(t('chat:library.deleteConfirmTitle'), t('chat:library.deleteConfirm', { title: label }), t('common:actions.delete'), t('common:actions.cancel'), () => void run(key, () => library.manage(row, 'delete'))) },
      ]}>
        <Pressable disabled={!row.connected} accessibilityRole="button" accessibilityState={{ selected: row.current, disabled: !row.connected }}
          accessibilityLabel={`${t('chat:library.open', { title: label })}, ${row.serverName}, ${row.projectPath}`} accessibilityHint={t('chat:library.swipeChatActions')}
          onPress={() => void run(key, () => registry.activate(row, row.sessionId), close)}
          style={[styles.row, { borderColor: row.current ? palette.tint : palette.border, backgroundColor: row.current ? palette.background : 'transparent', opacity: row.connected ? 1 : 0.6 }]}>
          <MaterialCommunityIcons name={row.current ? 'check-circle' : row.favorite ? 'star' : running ? 'progress-clock' : 'message-outline'} size={20} color={row.current || running || row.favorite ? palette.tint : palette.muted} />
          <View style={styles.copy}>
            <View style={styles.titleLine}>{row.favorite && row.current ? <MaterialCommunityIcons name="star" size={14} color={palette.tint} /> : null}<Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{label}</Text>
              {multipleServers ? <Text numberOfLines={1} style={[styles.chip, { color: palette.muted, borderColor: palette.border }]}>{row.serverName}</Text> : null}</View>
            <Text numberOfLines={1} style={{ color: palette.muted }}>{row.projectPath.split('/').pop()} · {row.preview || (running ? t('chat:library.running') : formatRelativeTime(row.session.time.updated))}</Text>
          </View>
        </Pressable>
      </SwipeRow>
    </View>;
  }
  if (serverCapabilities.contract === 'v1') return <LegacyChatLibrary visible={visible} onClose={onClose} onNewChat={onNewChat} />;
  return <>
    <OverlaySheet visible={visible && !projectVisible} title={t('chat:library.title')} testID="chat-library" scrollable={false} onClose={close}
      headerAction={<ProjectPickerButton onPress={() => setProjectVisible(true)} />}>
      <TextInput mode="outlined" testID="chat-library-search" label={t('chat:library.searchPlaceholder')} placeholder={t('chat:library.searchPlaceholder')} value={query} onChangeText={setQuery} />
      <View style={styles.filters}>
        {multipleServers ? <View style={{ flex: 1 }}><WorkspaceSelect title={t('common:servers.allServers')} value={server} testID="chat-server-filter" options={[{ value: '', label: t('common:servers.allServers') }, ...registry.connections.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => { setServer(value); setProject(''); }} /></View> : null}
        <View style={{ flex: 1 }}><WorkspaceSelect title={t('common:servers.allProjects')} value={project} testID="chat-project-filter" options={[{ value: '', label: t('common:servers.allProjects') }, ...projectOptions]} onChange={setProject} /></View>
      </View>
      <View style={styles.filters}><Text style={{ color: palette.muted, flex: 1 }}>{t('chat:library.swipeHint').replace(/^\s*·\s*/, '')}</Text><Text>{t('chat:library.hideSubagents')}</Text>
        <Switch testID="chat-hide-subagents" accessibilityLabel={t('chat:library.hideSubagentChats')} value={chatPreferences.hideSubagentChats} onValueChange={(hideSubagentChats) => updateChatPreferences({ hideSubagentChats })} /></View>
      {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
      {renaming ? <View style={styles.filters}><TextInput testID="chat-library-title-input" style={{ flex: 1 }} value={title} onChangeText={setTitle} /><Button onPress={() => void run(sessionKey(renaming), () => library.manage(renaming, 'rename', title), () => setRenaming(undefined))}>{t('common:actions.save')}</Button></View> : null}
      <FlashList data={rows} keyExtractor={sessionKey} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" renderItem={({ item }) => renderRow(item)}
        ListEmptyComponent={<Text style={{ color: palette.muted }}>{t(query.trim() ? 'chat:library.noMatchingChats' : 'chat:library.noChats')}</Text>} />
      <Button icon="plus" disabled={Boolean(busy)} onPress={onNewChat}>{t('chat:library.newChat')}</Button>
      <Text style={{ color: palette.muted, textAlign: 'center' }}>{multipleServers ? `${focusedServer} / ` : ''}{activeProject?.label}</Text>
    </OverlaySheet>
    <ProjectPicker visible={visible && projectVisible} testID="chat-project-picker" activePath={activeProject?.path} onClose={() => setProjectVisible(false)} onSelected={close} />
  </>;
}
const styles = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { minHeight: 68, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 }, titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  chip: { maxWidth: 120, fontSize: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
});
