import { cn } from '@/lib/utils';
import { ListRow } from '@/components/ui/list-row';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { ControlSize } from '@/constants/design-tokens';

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

  const basename = entry.path.split('/').pop() || entry.name;
  const [name, setName] = useState(basename);
  const valid = Boolean(name.trim()) && name !== basename && !/[/\\\x00-\x1f]/.test(name) && name !== '.' && name !== '..';
  const save = () => { if (valid && !busy && available) onRename(name); };
  const item = (label: string, icon: string, onPress: () => void, disabled: boolean, id: string) => <ListRow title={label} left={(props) => <Icon {...props} name={icon}></Icon>} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} testID={`project-entry-action-${id}`} style={{ minHeight: ControlSize.target }} disabled={disabled} onPress={onPress}></ListRow>;
  return <View className={cn("gap-sm")}>
    <Text className={cn("text-muted-foreground")}>{projectLabel}{' '}/ {entry.path}</Text>
    {!available && reason ? <Text>{reason}</Text> : null}
    {error ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{error}</Text> : null}
    {mode === 'rename' ? <>
      <TextField autoFocus testID="project-entry-name" label={t('project:files.actions.name')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} disabled={busy} returnKeyType="done" onSubmitEditing={save} invalid={!valid && name !== basename}></TextField>
      <View className={cn(stylesClasses.buttons)}>
        <Button disabled={busy} onPress={onClose} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
        <Button testID="project-entry-save" disabled={!valid || busy || !available} onPress={save} variant="default">{busy ? <Spinner size="small" /> : null}<Text>{t('common:actions.save')}</Text></Button>
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


const stylesClasses = {
  "buttons": "flex-row justify-end gap-sm"
} as const;
