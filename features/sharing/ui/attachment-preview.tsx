import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View } from 'react-native';
import { Image } from 'expo-image';

import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { AudioPreview, VideoPreview } from '@/shared/ui/media-preview';
import { attachmentKind, openAttachmentExternally, prepareAttachmentFile, readAttachmentText, validateAttachmentUri } from '@/shared/platform/attachments';
import type { PromptAttachment } from '@/shared/protocol/opencode/prompt-inbox';

export function AttachmentPreview({ attachment, onClose }: { attachment: PromptAttachment; onClose: () => void }) {
  const { t } = useTranslation();

  const kind = attachmentKind(attachment);
  const [text, setText] = useState<string>();
  const [mediaUri, setMediaUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingController = useRef<AbortController | undefined>(undefined);
  const fail = useCallback(() => setFailed(true), []);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    const controller = new AbortController();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { controller.abort(); openingController.current?.abort(); }
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
    return () => { cancelled = true; controller.abort(); openingController.current?.abort(); subscription.remove(); release?.(); };
  }, [attachment, kind]);

  return (
    <OverlaySheet visible title={attachment.filename || t('chat:composer.attachment')} onClose={onClose} testID="attachment-preview" scrollable={kind !== 'image' && kind !== 'video'}>
      {failed ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{t('chat:attachments.previewFailed')}</Text>
        : kind === 'image' ? mediaUri ? <Image testID="attachment-image-preview" source={{ uri: mediaUri }} contentFit="contain" className={cn(stylesClasses.image)} onError={() => setFailed(true)} /> : <Spinner />
          : kind === 'text' ? text === undefined ? <Spinner /> : <Text testID="attachment-text-preview" selectable className={cn("text-foreground")}>{text}</Text>
            : kind === 'audio' ? mediaUri ? <AudioPreview uri={mediaUri} onError={fail} /> : <Spinner />
              : kind === 'video' ? mediaUri ? <VideoPreview uri={mediaUri} onError={fail} /> : <Spinner />
              : <View className={cn(stylesClasses.audio)}>
                <Text className={cn("text-muted-foreground")}>{attachment.mime || t('chat:composer.attachment')}</Text>
                <Button testID="attachment-open-external" disabled={opening} onPress={() => {
                    setOpening(true);
                    const controller = new AbortController(); openingController.current = controller;
                    void openAttachmentExternally(attachment, controller.signal).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => setOpening(false));
                  }} variant="ghost">{opening ? <Spinner size="small" /> : null}<Icon name={"open-in-new"} size={20} /><Text>{t('chat:attachments.openExternally')}</Text></Button>
              </View>}
    </OverlaySheet>
  );
}

const stylesClasses = {
  "image": "flex-1 w-full min-h-0",
  "audio": "items-center gap-4 py-6"
} as const;
