import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon, IconButton } from 'react-native-paper';

import { AttachmentPreview } from '@/components/chat/attachment-preview';
import { attachmentKind } from '@/lib/attachment-preview';
import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';
import { usePalette } from '@/hooks/use-palette';

function AttachmentTile({ attachment, onPress }: { attachment: PromptAttachment; onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  const kind = attachmentKind(attachment);
  return (
    <Pressable testID="attachment-tile" accessibilityRole="button" accessibilityLabel={t('chat:attachments.preview', { name: attachment.filename || t('chat:composer.attachment') })}
      onPress={onPress} style={[styles.tile, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      {kind === 'image' && !failed ? <Image source={{ uri: attachment.uri }} contentFit="contain" style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
        : <Icon source={kind === 'audio' ? 'file-music-outline' : kind === 'video' ? 'video-outline' : kind === 'image' ? 'image-off-outline' : 'file-document-outline'} size={26} color={palette.text} />}
    </Pressable>
  );
}

export function AttachmentStrip({ attachments, onRemove }: { attachments: PromptAttachment[]; onRemove?: (index: number) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PromptAttachment>();
  return (
    <View style={styles.row}>
      {attachments.map((attachment, index) => (
        <View key={`${attachment.uri}-${index}`} style={styles.item}>
          <AttachmentTile attachment={attachment} onPress={() => setSelected(attachment)} />
          {onRemove ? <IconButton testID="attachment-remove" icon="close" size={16} style={styles.remove}
            accessibilityLabel={t('chat:composer.removeAttachment', { name: attachment.filename || t('chat:composer.attachment') })} onPress={() => onRemove(index)} /> : null}
        </View>
      ))}
      {selected ? <AttachmentPreview key={selected.uri} attachment={selected} onClose={() => setSelected(undefined)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center' },
  tile: { width: 56, height: 56, borderWidth: 1, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  remove: { width: 44, height: 44, margin: 0 },
});
