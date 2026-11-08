import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { MissionCounts, MissionFilter } from '@/shared/contracts/mission-control';
import { MISSION_FILTERS } from '@/shared/contracts/mission-control';
import { formatRelativeTime } from '@/shared/presentation/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { MissionRow } from '@/features/sessions/model/mission-control';

export function MissionSummary({ counts, filter, onFilter }: {
  counts: MissionCounts; filter?: MissionFilter; onFilter: (filter: MissionFilter) => void;
}) {
  const { t } = useTranslation('chat');
  const palette = usePalette();
  const icons = { attention: 'alert-outline', running: 'play-outline', failed: 'close-circle-outline', completed: 'check-circle-outline' } as const;
  const colors = { attention: palette.warning, running: palette.tint, failed: palette.danger, completed: palette.success };
  return <View className="gap-2">
    {[MISSION_FILTERS.slice(0, 2), MISSION_FILTERS.slice(2)].map((pair) => <View key={pair[0]} className="flex-row gap-2">
      {pair.map((key) => <Button key={key} variant="outline" className="min-h-[76px] flex-1 min-w-0 items-center justify-start px-3"
        style={filter === key ? { borderColor: palette.tint } : undefined}
        accessibilityRole="button" accessibilityState={{ selected: filter === key }}
        accessibilityLabel={`${counts[key]} ${t(`mission.${key}`)}`} onPress={() => onFilter(key)}>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center justify-between gap-1">
            <Text variant="display" className="text-display font-bold" style={{ color: colors[key] }}>{counts[key]}</Text>
            <Icon name={icons[key]} size={21} color={colors[key]} />
          </View>
          <Text>{t(`mission.${key}`)}</Text>
        </View>
      </Button>)}
    </View>)}
    <Text variant="description" className="self-end text-muted-foreground">{t('mission.completed')} · {t('mission.lastDay')}</Text>
  </View>;
}

export function MissionSessionRow({ row, error, busy, progress, onOpen }: {
  row: MissionRow; error?: boolean; busy?: boolean; progress?: { completed: number; total: number }; onOpen: () => void;
}) {
  const { t } = useTranslation('chat');
  const palette = usePalette();
  const badges = [row.permission && t('mission.permission'), row.question && t('mission.question'),
    row.status === 'running' && row.retrying && t('mission.retrying'), row.stale && t('mission.lastKnown')].filter(Boolean);
  const title = row.title || t('library.untitledChat');
  const location = [row.server, [row.project, row.worktree].filter(Boolean).join(' / '), row.agent, row.model].filter(Boolean).join(' · ');
  const when = formatRelativeTime(row.updatedAt);
  return <Pressable testID="mission-session-row" className="min-h-target flex-row items-center gap-2 border-border border-b py-3"
    accessibilityRole="button"
    accessibilityLabel={[title, t(`mission.${row.status}`), ...badges, location, when,
      progress && t('mission.progress', progress), error && t('mission.openFailed')].filter(Boolean).join(', ')}
    accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onOpen}>
    <View className="flex-1 min-w-0 gap-1">
      <Text variant="title">{title}</Text>
      {badges.length ? <View className="flex-row flex-wrap gap-1.5">
        {badges.map((badge) => <Badge key={String(badge)} variant="outline"><Text style={{ color: row.status === 'attention' ? palette.warning : palette.muted }}>{badge}</Text></Badge>)}
      </View> : null}
      <Text variant="description" className="text-muted-foreground">{location}</Text>
      {progress ? <Text variant="description" className="text-muted-foreground">{t('mission.progress', progress)}</Text> : null}
      {error ? <Text variant="description" style={{ color: palette.danger }}>{t('mission.openFailed')}</Text> : null}
    </View>
    <View className="flex-row items-center gap-1">
      <Text variant="description" className="text-muted-foreground">{when}</Text><Icon name="chevron-right" size={20} color={palette.muted} />
    </View>
  </Pressable>;
}
