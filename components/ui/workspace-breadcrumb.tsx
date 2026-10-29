import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WorktreeSwitcher } from '@/components/project/worktree-picker';
import { ProjectPicker } from '@/components/ui/project-picker';
import { usePalette } from '@/hooks/use-palette';
import { useProjectCheckouts } from '@/providers/use-project-checkouts';

export function WorkspaceBreadcrumb({ compact = false, testIDPrefix = 'workspace' }: { compact?: boolean; testIDPrefix?: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject, activeCheckout, multiple } = useProjectCheckouts();
  const [projectVisible, setProjectVisible] = useState(false);
  const [worktreeVisible, setWorktreeVisible] = useState(false);
  const projectLabel = activeProject?.label || t('chat:header.chooseProject');
  const worktreeLabel = activeCheckout?.isMain ? t('project:worktrees.local') : activeCheckout?.name;
  const branch = activeCheckout?.branch;
  const projectAccessibility = activeProject
    ? t('project:picker.changeProjectWithName', { name: activeProject.label })
    : t('project:picker.changeProject');

  return (
    <>
      <View style={[styles.row, compact && styles.rowCompact]}>
        <Pressable
          testID={`${testIDPrefix}-project-button`}
          accessibilityRole="button"
          accessibilityLabel={projectAccessibility}
          onPress={() => setProjectVisible(true)}
          style={({ pressed }) => [styles.control, compact && styles.controlCompact, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="folder-outline" size={compact ? 13 : 15} color={palette.muted} />
          <Text numberOfLines={1} style={[styles.projectLabel, compact && styles.projectLabelCompact, { color: palette.text }]}>{projectLabel}</Text>
          <MaterialCommunityIcons name="chevron-down" size={compact ? 13 : 15} color={palette.muted} />
        </Pressable>
        {multiple && worktreeLabel ? (
          <>
            <Text style={[styles.separator, { color: palette.muted }]}>/</Text>
            <Pressable
              testID={`${testIDPrefix}-worktree-button`}
              accessibilityRole="button"
              accessibilityLabel={t('project:worktrees.change', { name: worktreeLabel })}
              onPress={() => setWorktreeVisible(true)}
              style={({ pressed }) => [styles.control, compact && styles.controlCompact, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="source-branch" size={compact ? 13 : 15} color={palette.muted} />
              <View style={styles.worktreeText}>
                <Text numberOfLines={1} style={[styles.worktreeLabel, compact && styles.projectLabelCompact, { color: palette.text }]}>{worktreeLabel}</Text>
                {branch ? <Text numberOfLines={1} style={[styles.branchText, { color: palette.muted }]}>{branch}</Text> : null}
              </View>
              <MaterialCommunityIcons name="chevron-down" size={compact ? 13 : 15} color={palette.muted} />
            </Pressable>
          </>
        ) : branch ? (
          <View style={[styles.branchPill, { borderColor: palette.border }]}>
            <MaterialCommunityIcons name="source-branch" size={10} color={palette.muted} />
            <Text numberOfLines={1} style={[styles.branchText, { color: palette.muted }]}>{branch}</Text>
          </View>
        ) : null}
      </View>
      <ProjectPicker visible={projectVisible} activePath={activeProject?.path} testID="project-picker" onClose={() => setProjectVisible(false)} />
      {multiple && worktreeVisible ? <WorktreeSwitcher onClose={() => setWorktreeVisible(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 32, minWidth: 0 },
  rowCompact: { minHeight: 26 },
  control: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 4, minHeight: 32, minWidth: 0, paddingHorizontal: 4 },
  controlCompact: { minHeight: 26 },
  pressed: { opacity: 0.72 },
  projectLabel: { flexShrink: 1, fontSize: 13, fontWeight: '600', maxWidth: 150 },
  projectLabelCompact: { fontSize: 11.5 },
  worktreeText: { flexShrink: 1, minWidth: 0 },
  worktreeLabel: { fontSize: 13, fontWeight: '600', maxWidth: 120 },
  branchText: { fontSize: 9.5, maxWidth: 120 },
  branchPill: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 3, minHeight: 22, paddingHorizontal: 6 },
  separator: { fontSize: 13 },
});
