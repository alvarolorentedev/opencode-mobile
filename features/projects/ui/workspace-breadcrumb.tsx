import { cn } from '@/shared/ui/cn';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WorktreeSwitcher } from '@/features/projects/ui/worktree-picker';
import { ProjectPicker } from '@/features/projects/ui/project-picker';
import { Fonts } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useProjectCheckouts } from '@/features/projects/state/use-project-checkouts';

export function WorkspaceBreadcrumb({ testIDPrefix = 'workspace' }: { testIDPrefix?: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject, activeCheckout, multiple } = useProjectCheckouts();
  const [projectVisible, setProjectVisible] = useState(false);
  const [worktreeVisible, setWorktreeVisible] = useState(false);
  // A worktree picker opened for one project must not reappear when a later
  // project has checkouts again.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- switching projects dismisses the previous project's worktree picker.
  useEffect(() => { setWorktreeVisible(false); }, [activeProject?.path, multiple]);
  const projectLabel = activeProject?.label || t('chat:header.chooseProject');
  const worktreeLabel = activeCheckout?.isMain ? t('project:worktrees.local') : activeCheckout?.name;
  const branch = activeCheckout?.branch;
  const projectAccessibility = activeProject
    ? t('project:picker.changeProjectWithName', { name: activeProject.label })
    : t('project:picker.changeProject');

  return (
    <>
      <View className={stylesClasses.row}>
        <Pressable
          testID={`${testIDPrefix}-project-button`}
          accessibilityRole="button"
          accessibilityLabel={projectAccessibility}
          onPress={() => setProjectVisible(true)}
          style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="folder-outline" size={15} color={palette.muted} />
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" className={cn("text-foreground")} style={[styles.projectLabel]}>{projectLabel}</Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={palette.muted} />
        </Pressable>
        {multiple && worktreeLabel ? (
          <>
            <Text className={cn(stylesClasses.separator, "text-muted-foreground")}>/</Text>
            <Pressable
              testID={`${testIDPrefix}-worktree-button`}
              accessibilityRole="button"
              accessibilityLabel={t('project:worktrees.change', { name: worktreeLabel })}
              onPress={() => setWorktreeVisible(true)}
              style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="source-branch" size={14} color={palette.muted} />
              <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.worktreeLabel, "text-foreground")}>{worktreeLabel}</Text>
              {branch ? <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.branchText, "text-muted-foreground")}>{`· ${branch}`}</Text> : null}
              <MaterialCommunityIcons name="chevron-down" size={16} color={palette.muted} />
            </Pressable>
          </>
        ) : branch ? (
          <View className={cn(stylesClasses.branchPill, "border-border")}>
            <MaterialCommunityIcons name="source-branch" size={11} color={palette.muted} />
            <Text maxFontSizeMultiplier={1.5} numberOfLines={1} ellipsizeMode="tail" className={cn(stylesClasses.branchText, "text-muted-foreground")}>{branch}</Text>
          </View>
        ) : null}
      </View>
      <ProjectPicker visible={projectVisible} activePath={activeProject?.path} testID="project-picker" onClose={() => setProjectVisible(false)} />
      {multiple && worktreeVisible ? <WorktreeSwitcher onClose={() => setWorktreeVisible(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  control: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', flexShrink: 1, gap: 5, minHeight: 36, minWidth: 0, paddingHorizontal: 4 },
  pressed: { opacity: 0.72 },
  projectLabel: { flexShrink: 1, fontFamily: Fonts.display, fontSize: 14.5, fontWeight: '700', maxWidth: 140 }
});

const stylesClasses = {
  "row": "items-center flex-row gap-0.5 min-h-9 min-w-0",
  "separator": "text-[14px]",
  "worktreeLabel": "shrink text-[12px] font-semibold max-w-22.5",
  "branchText": "shrink text-[10.5px] max-w-22.5",
  "branchPill": "items-center rounded-[11px] border flex-row shrink gap-1 min-h-6 px-1.75"
} as const;
