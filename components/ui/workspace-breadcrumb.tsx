import { cn } from '@/lib/utils';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WorktreeSwitcher } from '@/components/project/worktree-picker';
import { ProjectPicker } from '@/components/ui/project-picker';
import { Fonts } from '@/constants/theme';
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
      <View className={cn(stylesClasses.row, compact && stylesClasses.rowCompact)}>
        <Pressable
          testID={`${testIDPrefix}-project-button`}
          accessibilityRole="button"
          accessibilityLabel={projectAccessibility}
          onPress={() => setProjectVisible(true)}
          style={({ pressed }) => [styles.control, compact && styles.controlCompact, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="folder-outline" size={compact ? 15 : 17} color={palette.muted} />
          <Text numberOfLines={1} ellipsizeMode="tail" className={cn(compact && stylesClasses.projectLabelCompact, "text-foreground")} style={[styles.projectLabel]}>{projectLabel}</Text>
          <MaterialCommunityIcons name="chevron-down" size={compact ? 16 : 18} color={palette.muted} />
        </Pressable>
        {multiple && worktreeLabel ? (
          <>
            <Text className={cn(stylesClasses.separator, "text-muted-foreground")}>/</Text>
            <Pressable
              testID={`${testIDPrefix}-worktree-button`}
              accessibilityRole="button"
              accessibilityLabel={t('project:worktrees.change', { name: worktreeLabel })}
              onPress={() => setWorktreeVisible(true)}
              style={({ pressed }) => [styles.control, compact && styles.controlCompact, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="source-branch" size={compact ? 14 : 16} color={palette.muted} />
              <Text numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.worktreeLabel, compact && stylesClasses.worktreeLabelCompact, "text-foreground")}>{worktreeLabel}</Text>
              {branch ? <Text numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.branchText, compact && stylesClasses.branchTextCompact, "text-muted-foreground")}>{`· ${branch}`}</Text> : null}
              <MaterialCommunityIcons name="chevron-down" size={compact ? 16 : 18} color={palette.muted} />
            </Pressable>
          </>
        ) : branch ? (
          <View className={cn(stylesClasses.branchPill, "border-border")}>
            <MaterialCommunityIcons name="source-branch" size={compact ? 11 : 12} color={palette.muted} />
            <Text numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.branchText, compact && stylesClasses.branchTextCompact, "text-muted-foreground")}>{branch}</Text>
          </View>
        ) : null}
      </View>
      <ProjectPicker visible={projectVisible} activePath={activeProject?.path} testID="project-picker" onClose={() => setProjectVisible(false)} />
      {multiple && worktreeVisible ? <WorktreeSwitcher onClose={() => setWorktreeVisible(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  control: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', flexShrink: 1, gap: 5, minHeight: 40, minWidth: 0, paddingHorizontal: 4 },
  controlCompact: { minHeight: 36 },
  pressed: { opacity: 0.72 },
  projectLabel: { flexShrink: 1, fontFamily: Fonts.display, fontSize: 16, fontWeight: '700', maxWidth: 160 }
});

const stylesClasses = {
  "row": "items-center flex-row gap-0.5 min-h-10 min-w-0",
  "rowCompact": "min-h-9",
  "projectLabelCompact": "text-[14.5px] max-w-35",
  "separator": "text-[14px]",
  "worktreeLabel": "shrink text-[13px] font-semibold max-w-27.5",
  "worktreeLabelCompact": "text-[12px] max-w-22.5",
  "branchText": "shrink text-[11.5px] max-w-27.5",
  "branchTextCompact": "text-[10.5px] max-w-22.5",
  "branchPill": "items-center rounded-[11px] border flex-row shrink gap-1 min-h-6 px-1.75"
} as const;
