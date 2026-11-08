import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MISSION_FILTERS, type MissionFilter } from '@/shared/contracts/mission-control';
import { sessionKey, workspaceKey, type SessionTarget } from '@/shared/contracts/workspace';
import { deriveTodosFromMessages } from '@/shared/presentation/format';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { useWorkspaces } from '@/runtime/workspace';
import { countMissionRows, type MissionRow, type MissionStatus } from '@/features/sessions/model/mission-control';
import { MissionSessionRow, MissionSummary } from '@/features/sessions/ui/mission-cards';

const ALL = '';
const noSections: { title: MissionStatus; data: MissionRow[] }[] = [];

export function MissionControlScreen() {
  const { t } = useTranslation('chat');
  const router = useRouter();
  const { filter: linkedFilter } = useLocalSearchParams<{ filter?: string }>();
  const { mission, navigate, snapshots } = useWorkspaces();
  const [server, setServer] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [filter, setFilter] = useState<MissionFilter>();
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState<string>();
  useFocusEffect(useCallback(() => {
    if (linkedFilter !== 'all' && !MISSION_FILTERS.some((key) => key === linkedFilter)) return;
    setFilter(linkedFilter === 'all' ? undefined : linkedFilter as MissionFilter);
    setServer(ALL);
    setProject(ALL);
    router.setParams({ filter: '' });
  }, [linkedFilter, router]));

  const selectedServer = mission.servers.some(({ id }) => id === server) ? server : ALL;
  const serverRows = useMemo(() => mission.rows.filter((row) => !selectedServer || row.target.connectionId === selectedServer), [mission.rows, selectedServer]);
  const projectOptions = useMemo(() => [...new Map(serverRows.map((row) => [row.projectKey, {
    value: row.projectKey, label: row.project, description: selectedServer ? undefined : row.server,
  }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [selectedServer, serverRows]);
  const selectedProject = projectOptions.some(({ value }) => value === project) ? project : ALL;
  const rows = useMemo(() => selectedProject ? serverRows.filter((row) => row.projectKey === selectedProject) : serverRows, [selectedProject, serverRows]);
  const counts = useMemo(() => countMissionRows(rows), [rows]);
  const sections = useMemo(() => {
    if (!rows.length) return noSections;
    const groups = new Map<MissionStatus, MissionRow[]>();
    for (const row of rows) {
      if (filter && row.status !== filter) continue;
      const group = groups.get(row.status);
      if (group) group.push(row);
      else groups.set(row.status, [row]);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [filter, rows]);
  const servers = mission.servers.filter(({ id }) => !selectedServer || selectedServer === id);
  const checked = servers.filter(({ phase }) => phase === 'ready').length;
  const unavailable = servers.filter(({ phase }) => phase === 'offline' || phase === 'unsupported');
  const partial = servers.filter(({ phase }) => phase === 'partial');
  const checking = servers.some(({ phase }) => phase === 'checking');
  const open = async (target: SessionTarget) => {
    if (opening) return;
    setOpening(sessionKey(target));
    setError(undefined);
    try {
      await navigate(target);
      router.navigate('/');
    } catch {
      setError(sessionKey(target));
    } finally {
      setOpening(undefined);
    }
  };

  return <View className="flex-1 bg-background" testID="mission-control">
    <ScreenHeader>
      <HeaderTitle title={t('mission.title')} />
      <Button variant="ghost" size="icon" accessibilityLabel={t('mission.refresh')} disabled={!servers.length}
        onPress={() => { servers.forEach((entry) => entry.refresh?.()); }}>
        <Icon name="refresh" size={24} />
      </Button>
    </ScreenHeader>
    <SectionList sections={sections} stickySectionHeadersEnabled={false} keyExtractor={(row) => row.key}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
      ListHeaderComponent={<View className="gap-3 pb-2">
        <View className="flex-row gap-2">
          <View className="flex-1 min-w-0">
            <WorkspaceSelect title={t('common:servers.allServers')} value={selectedServer} testID="mission-server-filter"
              options={[{ value: ALL, label: t('common:servers.allServers') }, ...mission.servers.map(({ id, name }) => ({ value: id, label: name }))]}
              onChange={(value) => { setServer(value); setProject(ALL); }} />
          </View>
          <View className="flex-1 min-w-0">
            <WorkspaceSelect title={t('common:servers.allProjects')} value={selectedProject} testID="mission-project-filter"
              options={[{ value: ALL, label: t('common:servers.allProjects') }, ...projectOptions]} onChange={setProject} />
          </View>
        </View>
        {checked < servers.length ? <View className="gap-1 rounded-control bg-secondary px-3 py-2">
          <Text variant="description">{t('mission.coverage', { checked, total: servers.length })}</Text>
          {unavailable.map(({ id, name, phase }) => <Text key={id} variant="description">{t(phase === 'unsupported' ? 'mission.unsupportedServer' : 'mission.offlineServer', { name })}</Text>)}
          {partial.map(({ id, name }) => <Text key={id} variant="description">{t('mission.partialServer', { name })}</Text>)}
        </View> : null}
        <MissionSummary counts={counts} filter={filter} onFilter={setFilter} />
        <Button variant={filter ? 'outline' : 'default'} size="sm" className="self-start" accessibilityState={{ selected: !filter }}
          onPress={() => setFilter(undefined)}><Text>{t('mission.allActivity')}</Text></Button>
        {!filter || filter === 'attention' ? servers.map(({ id, name, requests, globalTarget }) => requests > 0
          ? <ListRow key={id} title={t('mission.serverRequests', { name, count: requests })}
              description={globalTarget && error === globalTarget.key ? t('mission.openFailed') : undefined}
              onPress={globalTarget ? () => { void open(globalTarget.target); } : undefined} /> : null) : null}
      </View>}
      ListEmptyComponent={<Text variant="description" className="py-5 text-muted-foreground">
        {t(!servers.length ? 'mission.noServers' : checking ? 'mission.checking' : 'mission.empty')}
      </Text>}
      renderSectionHeader={({ section }) => <Text variant="heading" className="pb-1 pt-4" accessibilityRole="header">{t(`mission.${section.title}`)}</Text>}
      renderItem={({ item }) => {
        const native = snapshots[workspaceKey(item.target)]?.native;
        const records = native?.todoRecordsBySession[item.target.sessionId];
        const todos = records && !item.stale ? deriveTodosFromMessages(records) : [];
        const progress = todos.length ? { completed: todos.filter((todo) => todo.status === 'completed').length, total: todos.length } : undefined;
        return <MissionSessionRow row={item} error={error === item.key} busy={opening === item.key} progress={progress} onOpen={() => { void open(item.target); }} />;
      }} />
  </View>;
}
