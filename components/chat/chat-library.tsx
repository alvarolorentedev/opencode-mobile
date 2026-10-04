import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text as NativeText, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { SwipeRow, type SwipeRowAction } from '@/components/ui/swipe-row';
import { TextInput } from '@/components/ui/text-input';
import { WorkspacePicker, WorkspacePickerButton } from '@/components/ui/workspace-picker';
import { usePalette } from '@/providers/theme-provider';
import { formatRelativeTime, getSessionSubtitle } from '@/lib/opencode/format';
import type { GlobalSession, Session } from '@/lib/opencode/types';
import type { ActiveSessionItem, FavoriteSession } from '@/providers/opencode-provider-types';
import { useConnection, usePreferences, useSessions, useWorkspace } from '@/providers/opencode-contexts';

type LibraryRow =
  | { kind: 'heading' | 'empty'; id: string; title: string }
  | { kind: 'active'; id: string; value: ActiveSessionItem }
  | { kind: 'favorite'; id: string; value: FavoriteSession }
  | { kind: 'session'; id: string; value: Session }
  | { kind: 'archived'; id: string; value: GlobalSession };

export function ChatLibrary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject, addWorkspace, projects, refreshWorkspaceCatalog, selectProject } = useWorkspace();
  const {
    archivedSessions, archiveSession, clearFavoriteSession, createSession, currentSessionId, deleteSession,
    favoriteSessions, isFavoriteSession, openSession, openSessionInProject, refreshArchivedSessions,
    renameSession, restoreSession, sessionPreviewById, sessionStatuses, sessions, shareSession,
    toggleFavoriteSession, unshareSession,
    activeSessions, refreshActiveSessions,
  } = useSessions();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { serverCapabilities } = useConnection();
  const [workspaceVisible, setWorkspaceVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'active' | 'archived'>('active');
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const needle = query.trim().toLowerCase();
  const matches = (title: string, detail = '') => `${title} ${detail}`.toLowerCase().includes(needle);
  const activeSessionIds = new Set(activeSessions.map((session) => session.sessionId));
  const visibleSessions = sessions.filter((session) => !chatPreferences.hideSubagentChats || !session.parentID)
    .filter((session) => !activeSessionIds.has(session.id))
    .filter((session) => matches(session.title || t('chat:library.untitledChat'), sessionPreviewById[session.id] || ''))
    .sort((left, right) => {
      const priority = (session: Session) => session.id === currentSessionId ? 0 : sessionStatuses[session.id]?.type === 'idle' ? 2 : 1;
      return priority(left) - priority(right) || right.time.updated - left.time.updated;
    });
  const visibleFavorites = favoriteSessions.filter((favorite) => matches(favorite.title || t('chat:library.untitledChat'), favorite.projectPath));
  const visibleActiveSessions = activeSessions.filter((session) => matches(session.title || t('chat:library.untitledChat'), session.projectPath));
  const visibleArchived = archivedSessions.filter((session) => matches(session.title || t('chat:library.untitledChat'), session.directory));

  function confirm(title: string, message: string, action: string, run: () => void) {
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${message}`)) run(); return; }
    Alert.alert(title, message, [{ text: t('common:actions.cancel'), style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
  }
  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id); setError(undefined);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : t('chat:library.couldNotUpdate')); }
    finally { setBusyId(undefined); }
  }
  const close = () => { setWorkspaceVisible(false); setRenamingId(undefined); onClose(); };
  const open = (id: string) => void run(id, async () => { await openSession(id); close(); });
  const openActive = (id: string, projectPath: string) => void run(id, async () => { await openSessionInProject(projectPath, id); close(); });

  // Live current-workspace sessions win over the cross-workspace snapshot so a
  // rename or share change is reflected immediately in the Active group.
  const liveById = new Map(sessions.map((session) => [session.id, session]));

  // Shared row actions for the Active group and the current-workspace Chat list.
  // Project-scoped actions (rename/share/archive/delete) are only offered for
  // sessions in the active workspace; the scoped client cannot manage another
  // workspace's session, so cross-workspace rows stay open/favorite only.
  const sessionActions = (id: string, title: string | undefined, projectPath: string, shareUrl: string | undefined, manage: boolean): SwipeRowAction[] => {
    const favorite = isFavoriteSession(id);
    return [
      ...(manage ? [{ label: t('chat:library.rename'), icon: 'pencil-outline' as const, onPress: () => { setRenamingId(id); setRenameValue(title || ''); } }] : []),
      { label: favorite ? t('chat:library.unfavorite') : t('chat:library.favorite'), icon: favorite ? 'star-off-outline' : 'star-outline', onPress: () => toggleFavoriteSession(id, projectPath, title) },
      ...(manage && serverCapabilities.share ? [{ label: shareUrl ? t('chat:library.unshare') : t('chat:library.share'), icon: 'share-variant-outline' as const, onPress: () => {
        const share = () => void run(id, async () => { if (shareUrl) await unshareSession(id); else { const result = await shareSession(id); if (result.share?.url) await Clipboard.setStringAsync(result.share.url); } });
        if (shareUrl) share(); else confirm(t('chat:library.shareConfirmTitle'), t('chat:library.shareConfirmMessage'), t('chat:library.share'), share);
      } }] : []),
      ...(manage && serverCapabilities.archive ? [{ label: t('chat:library.archive'), icon: 'archive-outline' as const, onPress: () => void run(id, () => archiveSession(id)) }] : []),
      ...(manage ? [{ label: t('common:actions.delete'), icon: 'delete-outline' as const, onPress: () => confirm(t('chat:library.deleteConfirmTitle'), t('chat:library.deleteConfirm', { title: title || t('chat:library.untitledChat') }), t('common:actions.delete'), () => void run(id, () => deleteSession(id))) }] : []),
    ];
  };

  // Cross-workspace running/recent sessions are connection-scoped, not
  // workspace-scoped, so they are re-seeded whenever the overlay opens.
  useEffect(() => {
    if (!visible) return;
    void refreshActiveSessions().catch(() => undefined);
  }, [refreshActiveSessions, visible]);

  const rows: LibraryRow[] = section === 'active' ? [
    ...(visibleActiveSessions.length ? [{ kind: 'heading' as const, id: 'heading-active', title: t('chat:library.activeSessions') }] : []),
    ...visibleActiveSessions.map((value) => ({ kind: 'active' as const, id: `active:${value.sessionId}`, value })),
    ...(visibleFavorites.length ? [{ kind: 'heading' as const, id: 'heading-favorites', title: t('chat:library.favorites') }] : []),
    ...visibleFavorites.map((value) => ({ kind: 'favorite' as const, id: `favorite:${value.connectionScope}:${value.sessionId}`, value })),
    ...(visibleSessions.length ? [{ kind: 'heading' as const, id: 'heading-chats', title: t('chat:library.chats') }] : []),
    ...visibleSessions.map((value) => ({ kind: 'session' as const, id: `session:${value.id}`, value })),
    ...(!visibleSessions.length && !visibleActiveSessions.length && !visibleFavorites.length ? [{ kind: 'empty' as const, id: 'empty-chats', title: t(query.trim() ? 'chat:library.noMatchingChats' : 'chat:library.noChats') }] : []),
  ] : [
    ...visibleArchived.map((value) => ({ kind: 'archived' as const, id: `archived:${value.id}`, value })),
    ...(!visibleArchived.length ? [{ kind: 'empty' as const, id: 'empty-archived', title: t(query.trim() ? 'chat:library.noMatchingChats' : 'chat:library.noArchivedChats') }] : []),
  ];
  function renderRow(row: LibraryRow) {
    if (row.kind === 'heading' || row.kind === 'empty') return <Text variant={row.kind === 'heading' ? 'labelLarge' : 'bodyMedium'} style={{ color: palette.muted }}>{row.title}</Text>;
    if (row.kind === 'active') {
      const session = row.value;

      const live = liveById.get(session.sessionId);
      const title = live?.title ?? session.title;
      const manage = session.projectPath === activeProject?.path;
      const running = session.status.type !== 'idle';
      return <View key={session.sessionId}>
        <SwipeRow title={title || t('chat:library.untitledChat')} actions={sessionActions(session.sessionId, title, session.projectPath, live?.share?.url, manage)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat:library.open', { title: title || t('chat:library.untitledChat') })}
            accessibilityHint={t('chat:library.swipeChatActions')}
            onPress={() => openActive(session.sessionId, session.projectPath)}
            style={[styles.sessionItem, { backgroundColor: session.isCurrent ? palette.background : 'transparent', borderColor: session.isCurrent ? palette.tint : palette.border }]}>
            <MaterialCommunityIcons name={running ? 'progress-clock' : 'history'} size={20} color={running ? palette.tint : palette.muted} />
            <View style={styles.sessionText}>
              <NativeText numberOfLines={1} style={[styles.sessionTitle, { color: palette.text }]}>{title || t('chat:library.untitledChat')}</NativeText>
              <NativeText numberOfLines={1} style={{ color: palette.muted }}>{running ? `${t('chat:library.running')} · ` : ''}{session.projectPath.split('/').filter(Boolean).pop() || session.projectPath} · {formatRelativeTime(live?.time.updated ?? session.updatedAt)}</NativeText>
            </View>
          </Pressable>
        </SwipeRow>
        {renamingId === session.sessionId ? <View style={styles.renameRow}><TextInput testID="chat-library-title-input" mode="outlined" value={renameValue} onChangeText={setRenameValue} style={styles.renameInput} /><Button onPress={() => void run(session.sessionId, async () => { await renameSession(session.sessionId, renameValue); setRenamingId(undefined); })}>{t('common:actions.save')}</Button><Button onPress={() => setRenamingId(undefined)}>{t('common:actions.cancel')}</Button></View> : null}
      </View>;
    }
    if (row.kind === 'favorite') {
      const favorite = row.value;
      return <SwipeRow key={`${favorite.connectionScope}:${favorite.sessionId}`} title={favorite.title || t('chat:library.untitledChat')} actions={[{ label: t('chat:library.unfavorite'), icon: 'star-off-outline', onPress: () => clearFavoriteSession(favorite.sessionId) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat:library.open', { title: favorite.title || t('chat:library.untitledChat') })} accessibilityHint={t('chat:library.swipeRemoveFavorite')} onPress={() => void run(favorite.sessionId, async () => { await openSessionInProject(favorite.projectPath, favorite.sessionId, favorite.connectionScope); close(); })} style={[styles.sessionItem, { borderColor: palette.border }]}>
            <MaterialCommunityIcons name="star" size={20} color={palette.tint} /><View style={styles.sessionText}><NativeText numberOfLines={1} style={[styles.sessionTitle, { color: palette.text }]}>{favorite.title || t('chat:library.untitledChat')}</NativeText><NativeText numberOfLines={1} style={{ color: palette.muted }}>{favorite.projectPath.split('/').filter(Boolean).pop() || favorite.projectPath}</NativeText></View>
          </Pressable>
        </SwipeRow>;
    }
    if (row.kind === 'session') {
      const session = row.value;
      return <View key={session.id}>
          <SwipeRow title={session.title || t('chat:library.untitledChat')} actions={sessionActions(session.id, session.title, activeProject?.path || '', session.share?.url, true)}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('chat:library.open', { title: session.title || t('chat:library.untitledChat') })} accessibilityHint={t('chat:library.swipeChatActions')} onPress={() => open(session.id)} style={[styles.sessionItem, { backgroundColor: currentSessionId === session.id ? palette.background : 'transparent', borderColor: currentSessionId === session.id ? palette.tint : palette.border }]}>
              <MaterialCommunityIcons name={currentSessionId === session.id ? 'check-circle' : 'message-outline'} size={20} color={currentSessionId === session.id ? palette.tint : palette.muted} /><View style={styles.sessionText}><NativeText numberOfLines={1} style={[styles.sessionTitle, { color: palette.text }]}>{session.parentID ? '↳ ' : ''}{session.title || t('chat:library.untitledChat')}</NativeText><NativeText numberOfLines={1} style={{ color: palette.muted }}>{sessionPreviewById[session.id] || getSessionSubtitle(session)}</NativeText></View>
            </Pressable>
          </SwipeRow>
          {renamingId === session.id ? <View style={styles.renameRow}><TextInput testID="chat-library-title-input" mode="outlined" value={renameValue} onChangeText={setRenameValue} style={styles.renameInput} /><Button onPress={() => void run(session.id, async () => { await renameSession(session.id, renameValue); setRenamingId(undefined); })}>{t('common:actions.save')}</Button><Button onPress={() => setRenamingId(undefined)}>{t('common:actions.cancel')}</Button></View> : null}
        </View>;
    }
    if (row.kind === 'archived') {
      const session = row.value;
      return <SwipeRow key={session.id} title={session.title || t('chat:library.untitledChat')} actions={[
          { label: t('chat:library.restore'), icon: 'restore', onPress: () => void run(session.id, () => restoreSession(session.id)) },
          { label: t('common:actions.delete'), icon: 'delete-outline', onPress: () => confirm(t('chat:library.deleteArchivedTitle'), t('chat:library.deleteConfirm', { title: session.title || t('chat:library.untitledChat') }), t('common:actions.delete'), () => void run(session.id, async () => { await deleteSession(session.id); await refreshArchivedSessions(); })) },
        ]}><View style={[styles.sessionItem, { borderColor: palette.border }]}><MaterialCommunityIcons name="archive-outline" size={20} color={palette.muted} /><View style={styles.sessionText}><NativeText numberOfLines={1} style={[styles.sessionTitle, { color: palette.text }]}>{session.title || t('chat:library.untitledChat')}</NativeText><NativeText numberOfLines={1} style={{ color: palette.muted }}>{session.directory} · {formatRelativeTime(session.time.updated)}</NativeText></View></View></SwipeRow>;
    }
    return null;
  }

  return <>
    <OverlaySheet visible={visible && !workspaceVisible} title={t('chat:library.title')} testID="chat-library" scrollable={false} onClose={close} headerAction={<WorkspacePickerButton onPress={() => { void refreshWorkspaceCatalog(); setWorkspaceVisible(true); }} />}>
      <TextInput mode="outlined" testID="chat-library-search" placeholder={t('chat:library.searchPlaceholder')} value={query} onChangeText={setQuery} />
      <Text variant="bodySmall" style={{ color: palette.muted }}>{activeProject?.label || t('chat:library.chooseWorkspace')}{t('chat:library.swipeHint')}</Text>
      <View style={styles.sectionTabs}>
        <Button compact mode={section === 'active' ? 'contained-tonal' : 'text'} onPress={() => setSection('active')}>{t('chat:library.active')}</Button>
        {serverCapabilities.archive ? <Button compact mode={section === 'archived' ? 'contained-tonal' : 'text'} onPress={() => { setSection('archived'); void refreshArchivedSessions().catch((reason) => setError(reason instanceof Error ? reason.message : t('chat:library.couldNotLoadArchived'))); }}>{t('chat:library.archived')}</Button> : null}
        <View style={styles.filterToggle}><Text variant="labelMedium">{t('chat:library.hideSubagents')}</Text><Switch value={chatPreferences.hideSubagentChats} onValueChange={(hideSubagentChats) => updateChatPreferences({ hideSubagentChats })} accessibilityLabel={t('chat:library.hideSubagentChats')} /></View>
      </View>
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      <FlashList data={rows} style={{ flex: 1 }} keyExtractor={(row) => row.id} getItemType={(row) => row.kind}
        keyboardShouldPersistTaps="handled" renderItem={({ item }) => <View style={{ paddingBottom: 8 }}>{renderRow(item)}</View>} />
      <Button icon="plus" disabled={!activeProject || Boolean(busyId)} onPress={() => void run('new', async () => { const session = await createSession(); await openSession(session.id); close(); })}>{t('chat:library.newChat')}</Button>
    </OverlaySheet>

    <WorkspacePicker visible={visible && workspaceVisible} testID="chat-workspace-picker" projects={projects} activePath={activeProject?.path} onClose={() => setWorkspaceVisible(false)} onSelect={(path) => { selectProject(path); close(); }} onAdd={async (path) => { await addWorkspace(path); close(); }} />
  </>;
}

const styles = StyleSheet.create({
  sectionTabs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  sessionItem: { minHeight: 68, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionText: { flex: 1, minWidth: 0, gap: 3 },
  sessionTitle: { fontSize: 16, fontWeight: '600' },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  renameInput: { flex: 1 },
});
