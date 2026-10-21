import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { OpencodeProject } from '@/providers/opencode-provider-types';

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
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <>
      {projects.map((project) => (
        <View
          key={project.path}
          style={[
            styles.project,
            {
              borderColor: project.path === activePath ? palette.tint : palette.border,
              backgroundColor: project.path === activePath ? palette.background : 'transparent',
            },
          ]}>
          <Pressable
            disabled={disabled}
            accessibilityState={{ disabled }}
            accessibilityRole="button"
            accessibilityLabel={t('project:picker.selectLabel', { name: project.label })}
            onPress={() => onSelect(project.path)}
            style={styles.projectSelect}>
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
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('project:picker.removeLabel', { name: project.label })}
              testID={`project-remove-${project.path}`}
              onPress={() => onRemove(project.path)}
              style={styles.projectRemove}>
              <MaterialCommunityIcons name="close" size={20} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  project: { minHeight: 68, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  projectSelect: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectRemove: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  projectText: { flex: 1, gap: 3 },
  projectTitle: { fontSize: 16, fontWeight: '600' },
});
