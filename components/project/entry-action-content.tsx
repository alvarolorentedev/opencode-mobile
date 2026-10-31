import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';
import { TextInput } from '@/components/ui/text-input';
import { ControlSize, Spacing } from '@/constants/design-tokens';
import { usePalette } from '@/hooks/use-palette';
import type { ProjectFileEntry } from '@/lib/opencode/project';

export function EntryActionContent({ entry, projectLabel, mode, busy, available, reason, error, canPaste, onClose, onRename, onCopyPath, onSelect, onPaste }: {
  entry: ProjectFileEntry;
  projectLabel: string;
  mode: 'actions' | 'rename';
  busy: boolean;
  available: boolean;
  reason?: string;
  error?: string;
  canPaste: boolean;
  onClose: () => void;
  onRename: (name?: string) => void;
  onCopyPath: () => void;
  onSelect: (mode: 'copy' | 'cut') => void;
  onPaste: () => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const basename = entry.path.split('/').pop() || entry.name;
  const [name, setName] = useState(basename);
  const valid = Boolean(name.trim()) && name !== basename && !/[/\\\x00-\x1f]/.test(name) && name !== '.' && name !== '..';
  const save = () => { if (valid && !busy && available) onRename(name); };
  const item = (label: string, icon: string, onPress: () => void, disabled: boolean, id: string) => <List.Item
    title={label} titleNumberOfLines={3} left={(props) => <List.Icon {...props} icon={icon} />}
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    testID={`project-entry-action-${id}`} style={{ minHeight: ControlSize.target }} disabled={disabled} onPress={onPress} />;
  return <View style={{ gap: Spacing.sm }}>
    <Text style={{ color: palette.muted }}>{projectLabel} / {entry.path}</Text>
    {!available && reason ? <Text>{reason}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
    {mode === 'rename' ? <>
      <TextInput autoFocus mode="outlined" testID="project-entry-name" label={t('project:files.actions.name')}
        value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} disabled={busy}
        returnKeyType="done" onSubmitEditing={save} error={!valid && name !== basename} />
      <View style={styles.buttons}>
        <Button disabled={busy} onPress={onClose}>{t('common:actions.cancel')}</Button>
        <Button testID="project-entry-save" mode="contained" disabled={!valid || busy || !available} loading={busy} onPress={save}>{t('common:actions.save')}</Button>
      </View>
    </> : <>
      {item(t('project:files.actions.copyPath'), 'link-variant', onCopyPath, busy, 'copy-path')}
      {item(t('project:files.actions.rename'), 'pencil-outline', () => onRename(), busy || !available, 'rename')}
      {item(t('project:files.actions.copy'), 'content-copy', () => onSelect('copy'), busy || !available, 'copy')}
      {item(t('project:files.actions.cut'), 'content-cut', () => onSelect('cut'), busy || !available, 'cut')}
      {entry.type === 'directory' && canPaste ? item(t('project:files.actions.pasteInto'), 'clipboard-arrow-down-outline', onPaste, busy || !available, 'paste') : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({ buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm } });
