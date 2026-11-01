import { cn } from '@/shared/ui/cn';
import { Icon } from '@/shared/ui/icon';
import { Button } from '@/shared/ui/button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { AttachmentPreview } from '@/features/sharing/ui/attachment-preview';
import { attachmentKind } from '@/shared/platform/attachments';
import type { PromptAttachment } from '@/shared/protocol/opencode/prompt-inbox';
import { usePalette } from '@/shared/ui/theme/use-palette';

function AttachmentTile({ attachment, onPress }: { attachment: PromptAttachment; onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  const kind = attachmentKind(attachment);
  return (
    <Pressable testID="attachment-tile" accessibilityRole="button" accessibilityLabel={t('chat:attachments.preview', { name: attachment.filename || t('chat:composer.attachment') })}
      onPress={() => { Keyboard.dismiss(); onPress(); }} className={cn(stylesClasses.tile, "bg-surface-alt border-border")}>
      {kind === 'image' && !failed ? <>
        <Image source={{ uri: attachment.uri }} contentFit="contain" style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
        <View pointerEvents="none" testID="attachment-expand" className={cn(stylesClasses.expand)} style={{ backgroundColor: palette.surface }}>
          <Icon size={12} color={palette.text} name="arrow-expand" />
        </View>
      </>
        : <Icon size={26} color={palette.text} name={kind === 'audio' ? 'file-music-outline' : kind === 'video' ? 'video-outline' : kind === 'image' ? 'image-off-outline' : 'file-document-outline'}></Icon>}
    </Pressable>
  );
}

export function AttachmentStrip({ attachments, onRemove }: { attachments: PromptAttachment[]; onRemove?: (index: number) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PromptAttachment>();
  return (
    <View className={cn(stylesClasses.row)}>
      {attachments.map((attachment, index) => (
        <View key={`${attachment.uri}-${index}`} className={cn(stylesClasses.item)}>
          <AttachmentTile attachment={attachment} onPress={() => setSelected(attachment)} />
          {onRemove ? <Button testID="attachment-remove" accessibilityLabel={t('chat:composer.removeAttachment', { name: attachment.filename || t('chat:composer.attachment') })} onPress={() => onRemove(index)} variant="ghost" size="icon" className={cn(stylesClasses.remove)} ><Icon name={"close"} size={16} /></Button> : null}
        </View>
      ))}
      {selected ? <AttachmentPreview key={selected.uri} attachment={selected} onClose={() => setSelected(undefined)} /> : null}
    </View>
  );
}

const stylesClasses = {
  "tile": "w-14 h-14 border rounded-[8px] overflow-hidden items-center justify-center",
  "expand": "absolute bottom-0.5 right-0.5 h-5 w-5 rounded-full items-center justify-center opacity-90",
  "row": "flex-row flex-wrap gap-2",
  "item": "flex-row items-center",
  "remove": "w-11 h-11 m-0"
} as const;
