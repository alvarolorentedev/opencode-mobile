import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Modal, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Appbar, Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';
import { AudioPreview, VideoPreview } from '@/components/ui/media-preview';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRetainedState } from '@/components/ui/use-retained-state';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { useConnection } from '@/providers/opencode-contexts';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { confirmAction } from '@/lib/confirm-action';
import { prepareAttachmentBytes } from '@/lib/attachment-preview';
import { formatDataUsage } from '@/lib/opencode/data-usage';
import { MAX_PROJECT_PREVIEW_BYTES, type ProjectFile } from '@/lib/opencode/project-file';

export function FilePreview({ file, projectPath, branch, canSave, slim, onClose, onSave, onDownload }: {
  file: ProjectFile;
  projectPath: string;
  branch?: string;
  canSave: boolean;
  slim: boolean;
  onClose: () => void;
  onSave: (path: string, original: string, value: string) => Promise<void>;
  onDownload: (path: string, signal?: AbortSignal) => Promise<void>;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useUpdateBlocker(true);
  const palette = Colors[useColorScheme() ?? 'light'];
  const { settings } = useConnection();
  const [draft, setDraft] = useRetainedState<{ original: string; value: string } | undefined>(`editor:${JSON.stringify([getConnectionUiScope(settings), projectPath, file.path])}`, undefined);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();
  const [mediaUri, setMediaUri] = useState<string>();
  const [mediaFailed, setMediaFailed] = useState(false);
  const downloadController = useRef<AbortController | undefined>(undefined);
  const filename = file.path.split('/').pop() || file.path;
  const isText = file.kind === 'text';
  const isMedia = file.kind === 'image' || file.kind === 'audio' || file.kind === 'video';
  const tooLarge = file.size !== undefined && file.size > MAX_PROJECT_PREVIEW_BYTES;
  const dirty = draft && draft.value !== draft.original;
  const mediaHeight = Math.max(220, Math.min(520, Math.round(height * 0.52)));

  useEffect(() => {
    if (!isMedia || !file.bytes) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    const controller = new AbortController();
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') controller.abort(); });
    void prepareAttachmentBytes(file.bytes, file.mime, filename, controller.signal)
      .then((prepared) => {
        if (cancelled) prepared.release();
        else {
          release = prepared.release;
          setMediaUri(prepared.uri);
        }
      })
      .catch(() => { if (!cancelled) setMediaFailed(true); });
    return () => {
      cancelled = true;
      controller.abort();
      subscription.remove();
      release?.();
    };
  }, [file.bytes, file.mime, file.path, filename, isMedia]);

  useEffect(() => () => downloadController.current?.abort(), []);

  function leave(run: () => void) {
    if (saving) return;
    if (dirty) confirmAction(t('project:files.discardTitle'), t('project:files.discardMessage'), t('project:files.discard'), t('common:actions.cancel'), run);
    else run();
  }
  const close = () => leave(() => { setDraft(undefined); onClose(); });

  function download() {
    if (downloading || !file.canDownload) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError(undefined);
    void onDownload(file.path, controller.signal)
      .catch((reason) => {
        if (!controller.signal.aborted) setDownloadError(reason instanceof Error ? reason.message : t('project:errors.downloadFile'));
      })
      .finally(() => setDownloading(false));
  }

  const downloadAction = file.canDownload ? (
    <Button mode="contained" icon="download" loading={downloading} disabled={downloading} testID="project-file-download" onPress={download}>
      {t(Platform.OS === 'web' ? 'project:files.download' : 'project:files.saveOrOpen')}
    </Button>
  ) : null;

  function renderBinary() {
    if (file.kind === 'document') {
      return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32 }}>
        <MaterialCommunityIcons name="file-document-outline" size={56} color={palette.muted} />
        <Text variant="titleMedium" selectable style={{ color: palette.text }}>{filename}</Text>
        <Text style={{ color: palette.muted }}>{file.mime}{file.size !== undefined ? ` · ${formatDataUsage(file.size)}` : ''}</Text>
        <Text style={{ color: palette.muted, textAlign: 'center' }} testID="project-file-document-preview">{t('project:files.documentPreview')}</Text>
        {downloadAction || <Text testID="project-file-binary-unavailable" style={{ color: palette.muted }}>{t('project:files.binaryUnavailable')}</Text>}
      </View>;
    }
    if (!file.bytes) {
      return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32 }}>
        <MaterialCommunityIcons name="file-lock-outline" size={56} color={palette.muted} />
        <Text style={{ color: palette.muted, textAlign: 'center' }} testID={tooLarge ? 'project-file-preview-too-large' : 'project-file-binary-unavailable'}>
          {tooLarge ? t('project:files.previewTooLarge') : t('project:files.binaryUnavailable')}
        </Text>
        {downloadAction}
      </View>;
    }
    if (mediaFailed) {
      return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 32 }}>
        <MaterialCommunityIcons name="file-alert-outline" size={56} color={palette.muted} />
        <Text style={{ color: palette.muted }}>{t('project:files.previewFailed')}</Text>
        {downloadAction}
      </View>;
    }
    if (file.kind === 'image') {
      return mediaUri ? <Image testID="project-file-image-preview" source={{ uri: mediaUri }} contentFit="contain"
        style={{ width: '100%', height: mediaHeight, backgroundColor: palette.surfaceAlt, borderRadius: 12 }} onError={() => setMediaFailed(true)} />
        : <ActivityIndicator accessibilityLabel={t('project:files.loadingPreview')} />;
    }
    if (file.kind === 'audio') {
      return mediaUri ? <AudioPreview uri={mediaUri} onError={() => setMediaFailed(true)} /> : <ActivityIndicator accessibilityLabel={t('project:files.loadingPreview')} />;
    }
    if (file.kind === 'video') {
      return mediaUri ? <View style={{ height: mediaHeight, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.surfaceAlt }}>
        <VideoPreview uri={mediaUri} onError={() => setMediaFailed(true)} />
      </View> : <ActivityIndicator accessibilityLabel={t('project:files.loadingPreview')} />;
    }
    return null;
  }

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior="padding">
      <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }}>
        <Appbar.BackAction disabled={saving} accessibilityLabel={t('project:files.close')} onPress={close} />
        <Appbar.Content title={filename} subtitle={file.path} />
        {isText && file.canDownload ? <Appbar.Action icon="download" disabled={downloading} accessibilityLabel={t('project:files.download')} onPress={download} /> : null}
        {isText && canSave && !draft ? <Button onPress={() => setDraft({ original: file.content.content, value: file.content.content })}>{t('common:actions.edit')}</Button> : null}
      </Appbar.Header>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: slim ? 10 : 16, gap: 16, paddingBottom: Math.max(insets.bottom, 16), flexGrow: 1 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette.muted }}>{projectPath}</Text>
          {branch ? <Text style={{ color: palette.muted }}>{t('project:files.branch', { branch })}</Text> : null}
          {!isText && file.size !== undefined ? <Text style={{ color: palette.muted }}>{t('project:files.size', { size: formatDataUsage(file.size) })}</Text> : null}
        </View>
        {error || downloadError ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>{error || downloadError}</Text> : null}
        {isText ? <>
          {draft ? <>
            <Text style={{ color: palette.warning }}>{t('project:files.savingNotice')}</Text>
            <TextInput testID="project-file-editor" mode="outlined" multiline editable={!saving} value={draft.value}
              onChangeText={(value) => setDraft({ ...draft, value })} style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 13 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button testID="project-file-save-button" mode="contained" loading={saving} disabled={saving || !dirty} onPress={() => {
                setSaving(true); setError(undefined);
                void onSave(file.path, draft.original, draft.value).then(() => setDraft(undefined))
                  .catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.saveFile'))).finally(() => setSaving(false));
              }}>{t('project:files.savePatch')}</Button>
              <Button disabled={saving} onPress={() => leave(() => { setDraft(undefined); setError(undefined); })}>{t('common:actions.cancel')}</Button>
            </View>
          </> : <>
            <Text variant="labelLarge" style={{ color: palette.muted }}>{t('project:files.preview')}</Text>
            <Text selectable style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 22, color: palette.text }}>{file.content.content}</Text>
            {!canSave ? <Text style={{ color: palette.muted }}>{t('project:files.editingUnavailable')}</Text> : null}
          </>}
        </> : <>
          {renderBinary()}
          {file.kind !== 'document' && file.bytes && !tooLarge && !mediaFailed ? <View>{downloadAction}</View> : null}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Modal>;
}
