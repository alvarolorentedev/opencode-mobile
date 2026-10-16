import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import { DiffCard, SessionDiffCard } from '@/components/chat/chat-cards';
import { styles } from '@/components/chat/chat-view-styles';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { Colors } from '@/constants/theme';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff } from '@/lib/opencode/types';
import type { DiffScope, DiffTurn } from '@/providers/opencode-provider-types';

type Palette = typeof Colors.light;
type Connection = { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' }>;

const DIFF_SCOPE_OPTIONS: { value: DiffScope; labelKey: string }[] = [
  { value: 'turn', labelKey: 'chat:diff.turn' },
  { value: 'uncommitted', labelKey: 'chat:diff.uncommitted' },
  { value: 'branch', labelKey: 'chat:diff.branch' },
];

type ChangesOverlayProps = {
  changesVisible: boolean;
  connection: Connection;
  currentDiffScope: DiffScope;
  currentDiffs: FileDiff[];
  currentSessionId?: string;
  diffCount: number;
  diffDetails: DiffDetail[];
  diffTurns: DiffTurn[];
  expandedDiffId?: string;
  onCloseChanges: () => void;
  onExpandDiff: (id?: string) => void;
  onSelectDiffMessage: (messageId: string) => void;
  onSelectDiffScope: (scope: DiffScope) => void;
  palette: Palette;
  selectedDiffMessageId?: string;
};

export function ChangesOverlay({
  changesVisible,
  connection,
  currentDiffScope,
  currentDiffs,
  currentSessionId,
  diffCount,
  diffDetails,
  diffTurns,
  expandedDiffId,
  onCloseChanges,
  onExpandDiff,
  onSelectDiffMessage,
  onSelectDiffScope,
  palette,
  selectedDiffMessageId,
}: ChangesOverlayProps) {
  const { t } = useTranslation();
  const [diffSourcesVisible, setDiffSourcesVisible] = useState(false);
  const isTurnScope = currentDiffScope === 'turn';
  const isLatestTurn = diffTurns.length === 0 || selectedDiffMessageId === diffTurns[diffTurns.length - 1]?.id;
  const scopeTitle = currentDiffScope === 'uncommitted'
    ? t('chat:diff.uncommittedTitle')
    : currentDiffScope === 'branch'
      ? t('chat:diff.branchTitle')
      : isLatestTurn
        ? t('chat:diff.latestTurnTitle')
        : t('chat:diff.selectedTurnTitle');
  const scopeEmptyMessage = currentDiffScope === 'uncommitted'
    ? t('chat:diff.noUncommitted')
    : currentDiffScope === 'branch'
      ? t('chat:diff.noBranchChanges')
      : t('chat:diff.noChanges');
  const scopeLabel = t(DIFF_SCOPE_OPTIONS.find((option) => option.value === currentDiffScope)?.labelKey ?? 'chat:diff.turn');
  const selectedTurnLabel = diffTurns.find((turn) => turn.id === selectedDiffMessageId)?.label || t('chat:diff.latestTurn');
  const showDiffDetails = isTurnScope && currentDiffs.length === 0;

  useEffect(() => {
    if (!changesVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- never reopen a stale source picker with the review overlay.
      setDiffSourcesVisible(false);
    }
  }, [changesVisible, currentSessionId]);

  return (
    <>
      <OverlaySheet
        visible={changesVisible}
        testID="changes-overlay"
        title={t('chat:diff.filesChangedSimple', { files: diffCount, count: diffCount })}
        onClose={onCloseChanges}
        compact
        scrollable={false}
        headerAction={<IconButton
          icon="dots-vertical"
          accessibilityLabel={`${t('chat:diff.changeSourceLabel', { source: scopeLabel })}. ${scopeTitle}${isTurnScope ? ` · ${selectedTurnLabel}` : ''}`}
          onPress={() => setDiffSourcesVisible(true)}
          iconColor={palette.text}
        />}>
        <ScrollView
          style={[styles.scroll, { backgroundColor: palette.background }]}
          contentContainerStyle={styles.changesList}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          {connection.status === 'error' ? (
            <View style={styles.changesNotice}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.connectionIssue')}</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
            </View>
          ) : null}
          {currentDiffs.length === 0 && !(showDiffDetails && diffDetails.length > 0) ? (
            <Text variant="bodyMedium" style={[styles.changesNotice, { color: palette.muted }]}>{scopeEmptyMessage}</Text>
          ) : null}
          {currentDiffs.map((diff) => {
            const accordionId = `diff:${currentDiffScope}:${diff.file}`;
            return <SessionDiffCard key={accordionId} diff={diff} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
          })}
          {showDiffDetails ? diffDetails.map((detail) => {
            const accordionId = `detail:${detail.id}`;
            return <DiffCard key={detail.id} detail={detail} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
          }) : null}
        </ScrollView>
      </OverlaySheet>

      <OverlaySheet visible={changesVisible && diffSourcesVisible} testID="diff-source-overlay" title={t('chat:diff.sourceTitle')} fitContent onClose={() => setDiffSourcesVisible(false)}>
        {DIFF_SCOPE_OPTIONS.map((option) => <Pressable key={option.value} accessibilityRole="button" onPress={() => { onSelectDiffScope(option.value); if (option.value !== 'turn' || diffTurns.length <= 1) setDiffSourcesVisible(false); }} style={[styles.sessionPickerItemRow, { borderWidth: 1, borderRadius: 16, borderColor: currentDiffScope === option.value ? palette.tint : palette.border }]}>
          <MaterialCommunityIcons name={currentDiffScope === option.value ? 'check-circle' : 'circle-outline'} size={20} color={currentDiffScope === option.value ? palette.tint : palette.muted} />
          <Text style={{ color: palette.text }}>{t(option.labelKey)}</Text>
        </Pressable>)}
        {currentDiffScope === 'turn' && diffTurns.length > 1 ? <>
          <Text variant="labelLarge" style={{ color: palette.muted }}>{t('chat:diff.turn')}</Text>
          {diffTurns.map((turn) => <Pressable key={turn.id} accessibilityRole="button" onPress={() => { onSelectDiffMessage(turn.id); setDiffSourcesVisible(false); }} style={[styles.sessionPickerItemRow, { borderWidth: 1, borderRadius: 16, borderColor: selectedDiffMessageId === turn.id ? palette.tint : palette.border }]}>
            <MaterialCommunityIcons name={selectedDiffMessageId === turn.id ? 'check-circle' : 'circle-outline'} size={20} color={selectedDiffMessageId === turn.id ? palette.tint : palette.muted} />
            <Text style={{ color: palette.text }}>{turn.label}</Text>
          </Pressable>)}
        </> : null}
      </OverlaySheet>
    </>
  );
}
