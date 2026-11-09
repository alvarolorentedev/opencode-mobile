import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MISSION_JOB_STATUSES, type MissionJobStatus } from '@/shared/contracts/mission-control';
import { sessionKey, workspaceKey, type SessionTarget } from '@/shared/contracts/workspace';
import { deriveTodosFromMessages } from '@/shared/presentation/format';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { useWorkspaces } from '@/runtime/workspace';
import { countMissionRows } from '@/features/sessions/model/mission-control';
import type { MissionStatsHours } from '@/features/sessions/model/mission-stats';
import { useMissionStats } from '@/features/sessions/state/use-mission-stats';
import { MissionActivityChart } from '@/features/sessions/ui/mission-activity-chart';
import { MissionSessionRow, MissionSummary } from '@/features/sessions/ui/mission-cards';
import { MissionContributionChart } from '@/features/sessions/ui/mission-contribution-chart';
import { useMissionContributions } from '@/features/sessions/state/use-mission-contributions';

const ALL = '';
export function MissionControlScreen() {
  const { t } = useTranslation('chat');
  const router = useRouter();
  const visible = useIsFocused();
  const { filter: linkedFilter } = useLocalSearchParams<{ filter?: string }>();
  const { mission, navigate, snapshots } = useWorkspaces();
  const [server, setServer] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [status, setStatus] = useState<MissionJobStatus>();
  const [hours, setHours] = useState<MissionStatsHours>(24);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState<string>();
  useFocusEffect(useCallback(() => {
    if (!linkedFilter) return;
    setStatus(MISSION_JOB_STATUSES.find((key) => key === linkedFilter));
    setServer(ALL);
    setProject(ALL);
    router.setParams({ filter: '' });
  }, [linkedFilter, router]));

  const selectedServer = mission.servers.some(({ id }) => id === server) ? server : ALL;
  const serverRows = useMemo(() => mission.rows.filter((row) => !selectedServer || row.target.connectionId === selectedServer), [mission.rows, selectedServer]);
  const projectOptions = useMemo(() => [...new Map(serverRows.map((row) => [row.projectKey, {
    value: row.projectKey, label: row.project, description: selectedServer ? undefined : row.server,
    connectionId: row.target.connectionId, projectId: row.projectId,
  }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [selectedServer, serverRows]);
  const selectedProject = projectOptions.find(({ value }) => value === project);
  const rows = useMemo(() => selectedProject ? serverRows.filter((row) => row.projectKey === selectedProject.value) : serverRows, [selectedProject, serverRows]);
  const counts = useMemo(() => countMissionRows(rows), [rows]);
  const statusRows = useMemo(() => status ? rows.filter((row) => row.status === status) : [], [rows, status]);
  const scopedServer = selectedProject?.connectionId ?? selectedServer;
  const servers = mission.servers.filter(({ id }) => !scopedServer || scopedServer === id);
  const chart = useMissionStats(servers, selectedProject ? selectedProject.projectId ?? null : undefined, hours, visible, refreshedAt);
  const contributions = useMissionContributions(servers, selectedProject ? selectedProject.projectId ?? null : undefined, visible, refreshedAt);
  const checking = servers.some(({ phase }) => phase === 'checking');
  const serverRequests = status === 'attention' && !selectedProject ? servers.filter(({ requests }) => requests > 0) : [];
  const open = async (target: SessionTarget) => {
    if (opening) return;
    setOpening(sessionKey(target));
    setError(undefined);
    try {
      await navigate(target);
      setStatus(undefined);
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
        onPress={() => { servers.forEach((entry) => entry.refresh?.()); setRefreshedAt(Date.now()); }}>
        <Icon name="refresh" size={24} />
      </Button>
    </ScreenHeader>
    <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
      <View className="flex-row gap-2">
        <View className="flex-1 min-w-0">
          <WorkspaceSelect title={t('common:servers.allServers')} value={selectedServer} testID="mission-server-filter"
            options={[{ value: ALL, label: t('common:servers.allServers') }, ...mission.servers.map(({ id, name }) => ({ value: id, label: name }))]}
            onChange={(value) => { setServer(value); setProject(ALL); setRefreshedAt(Date.now()); }} />
        </View>
        <View className="flex-1 min-w-0">
          <WorkspaceSelect title={t('common:servers.allProjects')} value={selectedProject?.value ?? ALL} testID="mission-project-filter"
            options={[{ value: ALL, label: t('common:servers.allProjects') }, ...projectOptions]}
            onChange={(value) => { setProject(value); setRefreshedAt(Date.now()); }} />
        </View>
      </View>
      {!servers.length ? <Text variant="description" className="text-muted-foreground">{t('mission.noServers')}</Text> : null}
      <MissionSummary counts={counts} onOpen={setStatus} />
      <MissionContributionChart {...contributions} />
      <MissionActivityChart hours={hours} onRangeChange={(value) => {
        if (value !== hours) setHours(value);
      }} {...chart} />
    </ScrollView>
    <OverlaySheet visible={visible && Boolean(status)} title={status ? t(`mission.${status}`) : ''} testID="mission-status-overlay"
      fitContent scrollable={false} onClose={() => setStatus(undefined)}>
      <FlatList data={statusRows} keyExtractor={(row) => row.key} style={{ flexGrow: 0 }}
        ListHeaderComponent={serverRequests.length ? <View>{serverRequests.map(({ id, name, requests, globalTarget }) =>
          <ListRow key={id} title={t('mission.serverRequests', { name, count: requests })}
            description={globalTarget && error === globalTarget.key ? t('mission.openFailed') : undefined}
            onPress={globalTarget ? () => { void open(globalTarget.target); } : undefined} />)}</View> : undefined}
        ListEmptyComponent={serverRequests.length ? undefined : <Text variant="description" className="py-5 text-muted-foreground">
          {t(!servers.length ? 'mission.noServers' : checking ? 'mission.checking' : 'mission.empty')}
        </Text>}
        renderItem={({ item }) => {
          const native = snapshots[workspaceKey(item.target)]?.native;
          const records = native?.todoRecordsBySession[item.target.sessionId];
          const todos = records && !item.stale ? deriveTodosFromMessages(records) : [];
          const progress = todos.length ? { completed: todos.filter((todo) => todo.status === 'completed').length, total: todos.length } : undefined;
          return <MissionSessionRow row={item} error={error === item.key} busy={opening === item.key} progress={progress} onOpen={() => { void open(item.target); }} />;
        }} />
    </OverlaySheet>
  </View>;
}
