import { cn } from '@/lib/utils';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as NativeText, View } from 'react-native';

import type { OpencodeProject } from '@/providers/opencode-provider-types';
import { usePalette } from '@/hooks/use-palette';

/**
 * Presentational project row list shared by the project picker overlay and
 * the onboarding project step. Callers own empty/loading states; `onRemove`
 * closes a project for this connection without touching the server.
 */
export function ProjectOptions({
  projects,
  activePath,
  onSelect,
  onRemove,
  disabled = false,
}: {
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
  onRemove?: (path: string) => void;
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
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('project:picker.removeLabel', { name: project.label })}
              testID={`project-remove-${project.path}`}
              onPress={() => onRemove(project.path)}
              className={cn(stylesClasses.projectRemove)}>
              <MaterialCommunityIcons name="close" size={20} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}



const stylesClasses = {
  "project": "min-h-17 rounded-[16px] border flex-row items-center",
  "projectSelect": "flex-1 min-w-0 px-3.5 py-2.5 flex-row items-center gap-3",
  "projectText": "flex-1 gap-0.75",
  "projectTitle": "text-[16px] font-semibold",
  "projectRemove": "min-h-11 min-w-11 items-center justify-center"
} as const;
