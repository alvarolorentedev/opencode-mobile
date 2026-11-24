import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MISSION_JOB_STATUSES, type MissionCounts, type MissionJobStatus } from '@/shared/contracts/mission-control';
import { formatRelativeTime } from '@/shared/presentation/format';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/ui/cn';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { MissionRow } from '@/features/sessions/model/mission-control';

export function MissionSummary({ counts, onOpen }: {
  counts: MissionCounts; onOpen: (status: MissionJobStatus) => void;
}) {
  const { t } = useTranslation('chat');
  const palette = usePalette();
  const icons = { attention: 'alert-outline', running: 'play-outline', failed: 'close-circle-outline' } as const;
  const colors = { attention: palette.warning, running: palette.tint, failed: palette.danger };
  return <View className="flex-row rounded-control border border-border bg-secondary">
    {MISSION_JOB_STATUSES.map((key, index) => <Pressable key={key}
      className={cn('min-h-target flex-1 min-w-0 flex-row items-center justify-center gap-1 px-1 py-2 active:bg-muted', index > 0 && 'border-s border-border')}
      accessibilityRole="button" accessibilityLabel={`${counts[key]} ${t(`mission.${key}`)}`} onPress={() => onOpen(key)}>
      <Icon name={icons[key]} size={16} color={colors[key]} />
      <Text variant="label" style={{ color: colors[key] }}>{counts[key]}</Text>
      <Text variant="label" numberOfLines={1} className="shrink text-muted-foreground">{t(key === 'attention' ? 'mission.attentionShort' : `mission.${key}`)}</Text>
    </Pressable>)}
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
    {row.status === 'attention' ? <Icon name={row.permission ? 'shield-outline' : 'help-circle-outline'} size={24} color={palette.warning} /> : null}
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
