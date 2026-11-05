import { cn } from '@/shared/ui/cn';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as NativeText, View } from 'react-native';

import type { OpencodeProject } from '@/shared/contracts/domain';
import { usePalette } from '@/shared/ui/theme/use-palette';

/**
 * Presentational project row list shared by the project picker overlay and
 * the onboarding project step. Rows only select; there is no close action
 * because project selection is never stored locally. Callers own
 * empty/loading states.
 */
export function ProjectOptions({
  projects,
  activePath,
  onSelect,
  disabled = false,
}: {
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const palette = usePalette();

  return (
    <>
      {projects.map((project) => (
        <View
          key={project.path}
          className={cn(stylesClasses.project)} style={[{
              borderColor: project.path === activePath ? palette.tint : palette.border,
              backgroundColor: project.path === activePath ? palette.background : 'transparent',
            }]}>
          <Pressable
            disabled={disabled}
            accessibilityState={{ disabled }}
            accessibilityRole="button"
            accessibilityLabel={t('project:picker.selectLabel', { name: project.label })}
            onPress={() => onSelect(project.path)}
            className={cn(stylesClasses.projectSelect)}>
            <MaterialCommunityIcons
              name={project.path === activePath ? 'check-circle' : 'folder-outline'}
              size={20}
              color={project.path === activePath ? palette.tint : palette.muted}
            />
            <View className={cn(stylesClasses.projectText)}>
              <NativeText className={cn(stylesClasses.projectTitle, "text-foreground")}>{project.label}</NativeText>
              <NativeText numberOfLines={1} className={cn("text-muted-foreground")}>{project.path}</NativeText>
            </View>
          </Pressable>
        </View>
      ))}
    </>
  );
}

const stylesClasses = {
  "project": "min-h-17 rounded-[16px] border flex-row items-center",
  "projectSelect": "flex-1 min-w-0 px-3.5 py-2.5 flex-row items-center gap-3",
  "projectText": "flex-1 gap-0.75",
  "projectTitle": "text-[16px] font-semibold"
} as const;
