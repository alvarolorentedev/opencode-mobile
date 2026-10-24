import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { AudioPreview, VideoPreview } from '@/components/ui/media-preview';
import { attachmentKind, openAttachmentExternally, prepareAttachmentFile, readAttachmentText, validateAttachmentUri } from '@/lib/attachment-preview';
import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';
import { usePalette } from '@/hooks/use-palette';

export function AttachmentPreview({ attachment, onClose }: { attachment: PromptAttachment; onClose: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
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
      {failed ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{t('chat:attachments.previewFailed')}</Text>
        : kind === 'image' ? mediaUri ? <Image testID="attachment-image-preview" source={{ uri: mediaUri }} contentFit="contain" style={styles.image} onError={() => setFailed(true)} /> : <ActivityIndicator />
          : kind === 'text' ? text === undefined ? <ActivityIndicator /> : <Text testID="attachment-text-preview" selectable style={{ color: palette.text }}>{text}</Text>
            : kind === 'audio' ? mediaUri ? <AudioPreview uri={mediaUri} onError={fail} /> : <ActivityIndicator />
              : kind === 'video' ? mediaUri ? <VideoPreview uri={mediaUri} onError={fail} /> : <ActivityIndicator />
              : <View style={styles.audio}>
                <Text style={{ color: palette.muted }}>{attachment.mime || t('chat:composer.attachment')}</Text>
                <Button testID="attachment-open-external" loading={opening} disabled={opening} icon="open-in-new"
                  onPress={() => {
                    setOpening(true);
                    const controller = new AbortController(); openingController.current = controller;
                    void openAttachmentExternally(attachment, controller.signal).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => setOpening(false));
                  }}>
                  {t('chat:attachments.openExternally')}
                </Button>
              </View>}
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  image: { flex: 1, width: '100%', minHeight: 0 },
  audio: { alignItems: 'center', gap: 16, paddingVertical: 24 },
});
