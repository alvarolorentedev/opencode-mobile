import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { ProjectOptions } from '@/components/onboarding/project-options';
import { usePalette } from '@/providers/theme-provider';
import type { OpencodeProject } from '@/providers/opencode-provider-types';
import { OverlaySheet } from './overlay-sheet';
import { TextInput } from './text-input';

export function WorkspacePickerButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={t('workspace:picker.changeWorkspace')} onPress={onPress} style={styles.button}>
    <MaterialCommunityIcons name="folder-swap-outline" size={20} color={palette.tint} />
    <NativeText style={{ color: palette.tint }}>{t('common:tabs.workspace')}</NativeText>
  </Pressable>;
}

export function WorkspacePicker({ visible, onClose, projects, activePath, onSelect, onAdd, testID }: {
  visible: boolean;
  onClose: () => void;
  projects: OpencodeProject[];
  activePath?: string;
  onSelect: (path: string) => void;
  onAdd: (directory: string) => Promise<unknown>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => { setAdding(false); setDirectory(''); setError(undefined); onClose(); };
  return <OverlaySheet visible={visible} title={t('workspace:picker.title')} testID={testID} onClose={close}>
    {adding ? <View style={styles.addForm}>
      <Text style={{ color: palette.muted }}>{t('workspace:picker.enterPath')}</Text>
      <TextInput testID="workspace-add-path" mode="outlined" label={t('workspace:picker.serverDirectory')} value={directory} onChangeText={setDirectory} autoCapitalize="none" autoCorrect={false} />
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Button disabled={saving} onPress={() => { setAdding(false); setError(undefined); }}>{t('common:actions.cancel')}</Button>
        <Button testID="workspace-add-submit" mode="contained" loading={saving} disabled={saving || !directory.trim()} onPress={() => {
          setSaving(true); setError(undefined);
          void onAdd(directory).then(close).catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.addWorkspace'))).finally(() => setSaving(false));
        }}>{t('workspace:picker.add')}</Button>
      </View>
    </View> : <>
    <Button testID="workspace-add-button" icon="plus" mode="outlined" onPress={() => setAdding(true)}>{t('workspace:picker.add')}</Button>
    {projects.length === 0 ? <Text style={{ color: palette.muted }}>{t('workspace:picker.empty')}</Text> : null}
    <ProjectOptions activePath={activePath} onSelect={(path) => { onSelect(path); close(); }} projects={projects} />
    </>}
  </OverlaySheet>;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 6 },
  addForm: { gap: 12 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
