import { cn } from '@/shared/ui/cn';
import { ModalSurface } from '@/shared/ui/portal';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { TextField } from '@/shared/ui/text-field';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AudioPreview, VideoPreview } from '@/shared/ui/media-preview';
import { useRetainedState } from '@/runtime/workspace';
import { useUpdateBlocker } from '@/runtime/ui';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useConnection } from '@/features/connections/context';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { prepareAttachmentBytes } from '@/shared/platform/attachments';
import { formatDataUsage } from '@/shared/network/data-usage';
import { MAX_PROJECT_PREVIEW_BYTES } from '@/shared/contracts/project-preview';
import { type ProjectFile } from '@/shared/protocol/opencode/project-file';

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
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useUpdateBlocker(true);
  const palette = usePalette();
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
    <Button disabled={downloading} testID="project-file-download" onPress={download} variant={"default"}>{downloading ? <Spinner size="small" /> : null}<Icon name={"download"} size={20} /><Text>{t(Platform.OS === 'web' ? 'project:files.download' : 'project:files.saveOrOpen')}</Text></Button>
  ) : null;

  function renderBinary() {
    if (file.kind === 'document') {
      return <View className={cn("items-center gap-3 py-8")}>
        <MaterialCommunityIcons name="file-document-outline" size={56} color={palette.muted} />
        <Text selectable className={cn("text-foreground")} variant="title">{filename}</Text>
        <Text className={cn("text-muted-foreground")}>{file.mime}{file.size !== undefined ? ` · ${formatDataUsage(file.size)}` : ''}</Text>
        <Text className={cn("text-muted-foreground text-center")} testID="project-file-document-preview">{t('project:files.documentPreview')}</Text>
        {downloadAction || <Text testID="project-file-binary-unavailable" className={cn("text-muted-foreground")}>{t('project:files.binaryUnavailable')}</Text>}
      </View>;
    }
    if (!file.bytes) {
      return <View className={cn("items-center gap-3 py-8")}>
        <MaterialCommunityIcons name="file-lock-outline" size={56} color={palette.muted} />
        <Text className={cn("text-muted-foreground text-center")} testID={tooLarge ? 'project-file-preview-too-large' : 'project-file-binary-unavailable'}>{tooLarge ? t('project:files.previewTooLarge') : t('project:files.binaryUnavailable')}</Text>
        {downloadAction}
      </View>;
    }
    if (mediaFailed) {
      return <View className={cn("items-center gap-3 py-8")}>
        <MaterialCommunityIcons name="file-alert-outline" size={56} color={palette.muted} />
        <Text className={cn("text-muted-foreground")}>{t('project:files.previewFailed')}</Text>
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

  return <ModalSurface accessibilityLabel={filename} visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <KeyboardAvoidingView className={cn("flex-1 bg-background")} behavior="padding">
      <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }} safeArea={0 !== 0}><Button disabled={saving} accessibilityLabel={t('project:files.close')} onPress={close} variant={"ghost"} size="icon"><Icon name={"arrow-left"} size={24} /></Button><HeaderTitle title={filename} subtitle={file.path} maxFontSizeMultiplier={1.5}></HeaderTitle>{isText && file.canDownload ? <Button disabled={downloading} accessibilityLabel={t('project:files.download')} onPress={download} variant={"ghost"} size="icon"><Icon name={"download"} size={24} /></Button> : null}{isText && canSave && !draft ? <Button onPress={() => setDraft({ original: file.content.content, value: file.content.content })} variant={"ghost"}><Text>{t('common:actions.edit')}</Text></Button> : null}</ScreenHeader>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: slim ? 10 : 16, gap: 16, paddingBottom: Math.max(insets.bottom, 16), flexGrow: 1 }}>
        <View className={cn("gap-1.5")}>
          <Text className={cn("text-muted-foreground")}>{projectPath}</Text>
          {branch ? <Text className={cn("text-muted-foreground")}>{t('project:files.branch', { branch })}</Text> : null}
          {!isText && file.size !== undefined ? <Text className={cn("text-muted-foreground")}>{t('project:files.size', { size: formatDataUsage(file.size) })}</Text> : null}
        </View>
        {error || downloadError ? <Text accessibilityLiveRegion="polite" className={cn("text-destructive")}>{error || downloadError}</Text> : null}
        {isText ? <>
          {draft ? <>
            <Text className={cn("text-warning")}>{t('project:files.savingNotice')}</Text>
            <TextField testID="project-file-editor" multiline editable={!saving} value={draft.value} onChangeText={(value) => setDraft({ ...draft, value })} style={[{ minHeight: 240, fontFamily: 'monospace', fontSize: 13 }, undefined]}></TextField>
            <View className={cn("flex-row flex-wrap gap-2")}>
              <Button testID="project-file-save-button" disabled={saving || !dirty} onPress={() => {
                setSaving(true); setError(undefined);
                void onSave(file.path, draft.original, draft.value).then(() => setDraft(undefined))
                  .catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.saveFile'))).finally(() => setSaving(false));
              }} variant={"default"}>{saving ? <Spinner size="small" /> : null}<Text>{t('project:files.savePatch')}</Text></Button>
              <Button disabled={saving} onPress={() => leave(() => { setDraft(undefined); setError(undefined); })} variant={"ghost"}><Text>{t('common:actions.cancel')}</Text></Button>
            </View>
          </> : <>
            <Text className={cn("text-muted-foreground")} variant="description">{t('project:files.preview')}</Text>
            <Text selectable style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 22, color: palette.text }}>{file.content.content}</Text>
            {!canSave ? <Text className={cn("text-muted-foreground")}>{t('project:files.editingUnavailable')}</Text> : null}
          </>}
        </> : <>
          {renderBinary()}
          {file.kind !== 'document' && file.bytes && !tooLarge && !mediaFailed ? <View>{downloadAction}</View> : null}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
    {confirmation}
  </ModalSurface>;
}
