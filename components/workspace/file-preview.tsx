import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, ScrollView, View } from 'react-native';
import { Appbar, Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirmAction } from '@/lib/confirm-action';
import type { FileContent } from '@/lib/opencode/types';

export function FilePreview({ file, workspacePath, branch, canSave, slim, onClose, onSave }: {
  file: { path: string; content: FileContent };
  workspacePath: string;
  branch?: string;
  canSave: boolean;
  slim: boolean;
  onClose: () => void;
  onSave: (path: string, original: string, value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const palette = Colors[useColorScheme() ?? 'light'];
  const [draft, setDraft] = useState<{ original: string; value: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = draft && draft.value !== draft.original;
  function leave(run: () => void) {
    if (saving) return;
    if (dirty) confirmAction(t('workspace:files.discardTitle'), t('workspace:files.discardMessage'), t('workspace:files.discard'), t('common:actions.cancel'), run);
    else run();
  }
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => leave(onClose)}>
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior="padding">
      <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }}>
        <Appbar.BackAction disabled={saving} accessibilityLabel={t('workspace:files.close')} onPress={() => leave(onClose)} />
        <Appbar.Content title={file.path.split('/').pop() || file.path} subtitle={file.path} />
        {canSave && !draft ? <Button onPress={() => setDraft({ original: file.content.content, value: file.content.content })}>{t('common:actions.edit')}</Button> : null}
      </Appbar.Header>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: slim ? 10 : 16, gap: 16, paddingBottom: Math.max(insets.bottom, 16) }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette.muted }}>{workspacePath}</Text>
          {branch ? <Text style={{ color: palette.muted }}>{t('workspace:files.branch', { branch })}</Text> : null}
        </View>
        {error ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>{error}</Text> : null}
        {draft ? <>
          <Text style={{ color: palette.warning }}>{t('workspace:files.savingNotice')}</Text>
          <TextInput testID="workspace-file-editor" mode="outlined" multiline editable={!saving} value={draft.value}
            onChangeText={(value) => setDraft({ ...draft, value })} style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 13 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button testID="workspace-file-save-button" mode="contained" loading={saving} disabled={saving || !dirty} onPress={() => {
              setSaving(true); setError(undefined);
              void onSave(file.path, draft.original, draft.value).then(() => setDraft(undefined))
                .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.saveFile'))).finally(() => setSaving(false));
            }}>{t('workspace:files.savePatch')}</Button>
            <Button disabled={saving} onPress={() => leave(() => { setDraft(undefined); setError(undefined); })}>{t('common:actions.cancel')}</Button>
          </View>
        </> : <>
          <Text variant="labelLarge" style={{ color: palette.muted }}>{t('workspace:files.preview')}</Text>
          <Text selectable style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 22, color: palette.text }}>{file.content.content}</Text>
          {!canSave ? <Text style={{ color: palette.muted }}>{t('workspace:files.editingUnavailable')}</Text> : null}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Modal>;
}
