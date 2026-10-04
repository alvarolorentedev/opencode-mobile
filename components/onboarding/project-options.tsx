import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';

import { usePalette } from '@/providers/theme-provider';
import type { OpencodeProject } from '@/providers/opencode-provider-types';

/**
 * Presentational project row list shared by the workspace picker overlay and
 * the onboarding workspace step. Callers own empty/loading states.
 */
export function ProjectOptions({
  projects,
  activePath,
  onSelect,
}: {
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();

  return (
    <>
      {projects.map((project) => (
        <Pressable
          key={project.path}
          accessibilityRole="button"
          accessibilityLabel={t('workspace:picker.selectLabel', { name: project.label })}
          onPress={() => onSelect(project.path)}
          style={[
            styles.project,
            {
              borderColor: project.path === activePath ? palette.tint : palette.border,
              backgroundColor: project.path === activePath ? palette.background : 'transparent',
            },
          ]}>
          <MaterialCommunityIcons
            name={project.path === activePath ? 'check-circle' : 'folder-outline'}
            size={20}
            color={project.path === activePath ? palette.tint : palette.muted}
          />
          <View style={styles.projectText}>
            <NativeText style={[styles.projectTitle, { color: palette.text }]}>{project.label}</NativeText>
            <NativeText numberOfLines={1} style={{ color: palette.muted }}>{project.path}</NativeText>
          </View>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  project: { minHeight: 68, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectText: { flex: 1, gap: 3 },
  projectTitle: { fontSize: 16, fontWeight: '600' },
});
