import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { WorktreePicker } from '@/components/project/worktree-picker';
import { useProjectFiles } from '@/providers/opencode-contexts';
import { ProjectOptions } from '@/components/onboarding/project-options';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { OpencodeProject } from '@/providers/opencode-provider-types';
import { OverlaySheet } from './overlay-sheet';
import { TextInput } from './text-input';

export function ProjectPickerButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  return <Pressable accessibilityRole="button" accessibilityLabel={t('project:picker.changeProject')} onPress={onPress} style={styles.button}>
    <MaterialCommunityIcons name="folder-swap-outline" size={20} color={palette.tint} />
    <NativeText style={{ color: palette.tint }}>{t('common:tabs.projects')}</NativeText>
  </Pressable>;
}

export function ProjectPicker({ visible, onClose, projects, activePath, onSelect, onRemove, onAdd, testID }: {
  visible: boolean;
  onClose: () => void;
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
  onRemove?: (path: string) => void;
  onAdd: (directory: string) => Promise<unknown>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { worktrees } = useProjectFiles();
  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => { setAdding(false); setDirectory(''); setError(undefined); onClose(); };
  return <OverlaySheet visible={visible} title={t('project:picker.title')} testID={testID} onClose={close}>
    {adding ? <View style={styles.addForm}>
      <Text style={{ color: palette.muted }}>{t('project:picker.enterPath')}</Text>
      <TextInput testID="project-add-path" mode="outlined" label={t('project:picker.serverDirectory')} value={directory} onChangeText={setDirectory} autoCapitalize="none" autoCorrect={false} />
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Button disabled={saving} onPress={() => { setAdding(false); setError(undefined); }}>{t('common:actions.cancel')}</Button>
        <Button testID="project-add-submit" mode="contained" loading={saving} disabled={saving || !directory.trim()} onPress={() => {
          setSaving(true); setError(undefined);
          void onAdd(directory).then(close).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.addProject'))).finally(() => setSaving(false));
        }}>{t('project:picker.add')}</Button>
      </View>
    </View> : <>
    {projects.length === 0 ? <Text style={{ color: palette.muted }}>{t('project:picker.empty')}</Text> : null}
    <ProjectOptions activePath={activePath} onSelect={(path) => { onSelect(path); close(); }} onRemove={onRemove} projects={projects.filter((project) => project.path === worktrees.project?.root || !worktrees.entries.some((entry) => entry.directory === project.path))} />
    {visible ? <WorktreePicker key={activePath} visible onSelect={(path) => { onSelect(path); close(); }} /> : null}
    <Button testID="project-add-button" icon="plus" onPress={() => setAdding(true)}>{t('project:picker.add')}</Button>
    </>}
  </OverlaySheet>;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 6 },
  addForm: { gap: 12 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
