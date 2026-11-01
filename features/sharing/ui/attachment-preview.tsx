import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, View } from 'react-native';

import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { AudioPreview, VideoPreview } from '@/shared/ui/media-preview';
import { attachmentKind, openAttachmentExternally, prepareAttachmentFile, readAttachmentText, validateAttachmentUri } from '@/shared/platform/attachments';
import type { PromptAttachment } from '@/shared/protocol/opencode/prompt-inbox';
import { AttachmentImageViewer } from '@/features/sharing/ui/attachment-image-viewer';

export function AttachmentPreview({ attachment, onClose }: { attachment: PromptAttachment; onClose: () => void }) {
  const { t } = useTranslation();

  const kind = attachmentKind(attachment);
  const filename = attachment.filename || t('chat:composer.attachment');
  const [text, setText] = useState<string>();
  const [mediaUri, setMediaUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const actionController = useRef<AbortController | undefined>(undefined);
  const fail = useCallback(() => setFailed(true), []);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    const controller = new AbortController();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { controller.abort(); actionController.current?.abort(); }
    });
    void (async () => {
      validateAttachmentUri(attachment.uri);
      if (kind === 'text') {
        const contents = await readAttachmentText(attachment, controller.signal);
        if (!cancelled) setText(contents);
      } else if (kind === 'audio' || kind === 'video' || kind === 'image') {
        const file = await prepareAttachmentFile(attachment, controller.signal);
        release = file.release;
        if (cancelled) release();
        else setMediaUri(file.uri);
      }
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; controller.abort(); actionController.current?.abort(); subscription.remove(); release?.(); };
  }, [attachment, kind]);

  const save = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setActionError(false);
    const controller = new AbortController();
    actionController.current = controller;
    void openAttachmentExternally(attachment, controller.signal)
      .catch(() => { if (!controller.signal.aborted) setActionError(true); })
      .finally(() => setBusy(false));
  }, [attachment, busy]);

  if (kind === 'image') {
    return <AttachmentImageViewer failed={failed} filename={filename} mediaUri={mediaUri} onClose={onClose} onImageError={fail} onSave={save} saveError={actionError} saving={busy} />;
  }

  const saveLabel = t(Platform.OS === 'web' ? 'chat:attachments.download' : 'chat:attachments.saveOrShare');
  const saveAction = kind === 'document' ? undefined : (
    <Button accessibilityLabel={saveLabel} disabled={busy || failed} onPress={save} size="icon" testID="attachment-save" variant="ghost">
      {busy ? <Spinner size="small" /> : <Icon name="download" size={20} />}
    </Button>
  );

  return (
    <OverlaySheet visible title={filename} onClose={onClose} testID="attachment-preview" scrollable={kind !== 'video'} headerAction={saveAction}>
      {failed ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{t('chat:attachments.previewFailed')}</Text>
        : kind === 'text' ? text === undefined ? <Spinner /> : <Text testID="attachment-text-preview" selectable className={cn("text-foreground")}>{text}</Text>
          : kind === 'audio' ? mediaUri ? <AudioPreview uri={mediaUri} onError={fail} /> : <Spinner />
            : kind === 'video' ? mediaUri ? <VideoPreview uri={mediaUri} onError={fail} /> : <Spinner />
              : <View className={cn(stylesClasses.audio)}>
                <Text className={cn("text-muted-foreground")}>{attachment.mime || t('chat:composer.attachment')}</Text>
                <Button testID="attachment-open-external" disabled={busy} onPress={save} variant="ghost">{busy ? <Spinner size="small" /> : null}<Icon name={"open-in-new"} size={20} /><Text>{t('chat:attachments.openExternally')}</Text></Button>
              </View>}
      {actionError ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{t('chat:attachments.saveFailed')}</Text> : null}
    </OverlaySheet>
  );
}

const stylesClasses = {
  "audio": "items-center gap-4 py-6"
} as const;
