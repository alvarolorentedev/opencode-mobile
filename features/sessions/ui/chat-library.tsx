import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { TextField } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/shared/ui/switch';
import { Pressable, View } from 'react-native';

import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { SwipeRow } from '@/shared/ui/swipe-row';

import { ProjectPicker, ProjectPickerButton } from '@/features/projects/index';
import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { formatRelativeTime } from '@/shared/presentation/format';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { usePreferences } from '@/shared/preferences/context';
import { useProjects } from '@/features/projects/context';
import { useWorkspaces } from '@/runtime/workspace';
import { useWorkspaceLibrary } from '@/features/sessions/ui/use-workspace-library';
import { sessionKey, workspaceKey } from '@/shared/contracts/workspace';
import type { LibrarySession } from '@/features/sessions/model/workspace-library';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function ChatLibrary({ visible, onClose, onNewChat }: { visible: boolean; onClose: () => void; onNewChat: () => void }) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject } = useProjects();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const registry = useWorkspaces();
  const multipleServers = registry.connections.length > 1;
  const library = useWorkspaceLibrary(visible);
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
    const inFlight = busy === key;
    return <View className={cn("pb-2")}>
      <SwipeRow title={label} actions={[
        { label: t('chat:library.rename'), icon: 'pencil-outline', onPress: () => { setRenaming(row); setTitle(label); setError(undefined); } },
        { label: t(row.favorite ? 'chat:library.unfavorite' : 'chat:library.favorite'), icon: row.favorite ? 'star-off-outline' : 'star-outline', onPress: () => void run(key, () => library.manage(row, 'favorite', row.session.title)) },
        { label: t('common:actions.delete'), icon: 'delete-outline', onPress: () => confirmAction(t('chat:library.deleteConfirmTitle'), t('chat:library.deleteConfirm', { title: label }), t('common:actions.delete'), t('common:actions.cancel'), () => void run(key, () => library.manage(row, 'delete'))) },
      ]}>
        <Pressable disabled={!row.connected} accessibilityRole="button" accessibilityState={{ selected: row.current, disabled: !row.connected, busy: inFlight }}
          accessibilityLabel={`${t('chat:library.open', { title: label })}, ${row.serverName}, ${row.projectPath}`} accessibilityHint={t('chat:library.swipeChatActions')}
          onPress={() => void run(key, () => registry.navigate(row), close)}
          className={cn(stylesClasses.row)} style={[{ borderColor: row.current ? palette.tint : palette.border, backgroundColor: row.current ? palette.background : 'transparent', opacity: row.connected ? 1 : 0.6 }]}>
          {inFlight ? <Spinner size={20} color={palette.tint} testID="chat-library-busy" />
            : <MaterialCommunityIcons name={row.current ? 'check-circle' : row.favorite ? 'star' : running ? 'progress-clock' : 'message-outline'} size={20} color={row.current || running || row.favorite ? palette.tint : palette.muted} />}
          <View className={cn(stylesClasses.copy)}>
            <View className={cn(stylesClasses.titleLine)}>{row.favorite && row.current ? <MaterialCommunityIcons name="star" size={14} color={palette.tint} /> : null}<Text numberOfLines={1} className={cn(stylesClasses.title, "text-foreground")}>{label}</Text></View>
            <View className={cn(stylesClasses.metaLine)}>
              {multipleServers ? <Text testID="chat-library-server-chip" numberOfLines={1} className={cn(stylesClasses.chip, "text-muted-foreground border-border")}>{row.serverName}</Text> : null}
              <Text numberOfLines={1} className={cn(stylesClasses.metaText, "text-muted-foreground")}>{row.projectPath.split('/').pop()}{' · '}{row.preview || (running ? t('chat:library.running') : formatRelativeTime(row.session.time.updated))}</Text>
            </View>
          </View>
        </Pressable>
      </SwipeRow>
    </View>;
  }
  return <>{confirmation}{<>
    <OverlaySheet visible={visible && !projectVisible} title={t('chat:library.title')} testID="chat-library" scrollable={false} onClose={close}
      headerAction={<ProjectPickerButton onPress={() => setProjectVisible(true)} />}>
      <TextField testID="chat-library-search" label={t('chat:library.searchPlaceholder')} placeholder={t('chat:library.searchPlaceholder')} value={query} onChangeText={setQuery}></TextField>
      <View className={cn(stylesClasses.filters)}>
        {multipleServers ? <View className={cn("flex-1")}><WorkspaceSelect title={t('common:servers.allServers')} value={server} testID="chat-server-filter" options={[{ value: '', label: t('common:servers.allServers') }, ...registry.connections.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => { setServer(value); setProject(''); }} /></View> : null}
        <View className={cn("flex-1")}><WorkspaceSelect title={t('common:servers.allProjects')} value={project} testID="chat-project-filter" options={[{ value: '', label: t('common:servers.allProjects') }, ...projectOptions]} onChange={setProject} /></View>
      </View>
      <View className={cn(stylesClasses.filters)}><Text className={cn("text-muted-foreground flex-1")}>{t('chat:library.swipeHint').replace(/^\s*·\s*/, '')}</Text><Text>{t('chat:library.hideSubagents')}</Text>
        <Switch testID="chat-hide-subagents" accessibilityLabel={t('chat:library.hideSubagentChats')} checked={Boolean(chatPreferences.hideSubagentChats)} onCheckedChange={(hideSubagentChats) => updateChatPreferences({ hideSubagentChats })} /></View>
      {error ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{error}</Text> : null}
      {renaming ? (() => {
        const renameBusy = busy === sessionKey(renaming);
        const canSave = title.trim().length > 0 && !renameBusy;
        const cancel = () => { setRenaming(undefined); setTitle(''); setError(undefined); };
        const save = () => {
          if (!canSave) return;
          void run(sessionKey(renaming), () => library.manage(renaming, 'rename', title.trim()), () => { setRenaming(undefined); setTitle(''); });
        };
        return <View className={cn(stylesClasses.renameForm, "border-border bg-background")}>
          <TextField testID="chat-library-title-input" autoFocus label={t('chat:library.rename')} returnKeyType="done" value={title} onChangeText={setTitle} onSubmitEditing={save} className={cn("flex-1")} ></TextField>
          <View className={cn(stylesClasses.renameActions)}>
            <Button disabled={renameBusy} onPress={cancel} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
            <Button disabled={!canSave} onPress={save} variant="default">{renameBusy ? <Spinner size="small" /> : null}<Text>{t('common:actions.save')}</Text></Button>
          </View>
        </View>;
      })() : null}
      <FlashList data={rows} extraData={busy} keyExtractor={sessionKey} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" renderItem={({ item }) => renderRow(item)}
        ListEmptyComponent={<Text style={{ color: palette.muted }}>{t(query.trim() ? 'chat:library.noMatchingChats' : 'chat:library.noChats')}</Text>} />
      <Button disabled={Boolean(busy)} onPress={onNewChat} variant="ghost"><Icon name={"plus"} size={20} /><Text>{t('chat:library.newChat')}</Text></Button>
      <Text className={cn("text-muted-foreground text-center")}>{multipleServers ? `${focusedServer} / ` : ''}{activeProject?.label}</Text>
    </OverlaySheet>
    {visible && projectVisible ? <ProjectPicker visible testID="chat-project-picker" activePath={activeProject?.path} onClose={() => setProjectVisible(false)} onSelected={close} /> : null}
  </>}</>;
}

const stylesClasses = {
  "row": "min-h-17 rounded-[16px] border px-3.5 py-2.5 flex-row items-center gap-3",
  "copy": "flex-1 min-w-0 gap-0.75",
  "titleLine": "flex-row items-center gap-2 min-w-0",
  "title": "flex-1 min-w-0 text-[16px] font-semibold",
  "metaLine": "flex-row items-center gap-1.5 min-w-0",
  "chip": "shrink-0 max-w-30 text-[12px] border rounded-[12px] px-2 py-0.75",
  "metaText": "shrink min-w-0",
  "filters": "flex-row items-center gap-2",
  "renameForm": "border rounded-[14px] p-2.5 gap-2",
  "renameActions": "flex-row justify-end gap-2"
} as const;
