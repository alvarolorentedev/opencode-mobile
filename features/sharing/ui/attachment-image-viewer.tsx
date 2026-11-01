import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { ModalSurface } from '@/shared/ui/portal';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { clampImageScale, clampImageTranslation, toggleImageScale, MIN_IMAGE_SCALE } from '@/features/sharing/model/image-transform';
import { usePalette } from '@/shared/ui/theme/use-palette';

type AttachmentImageViewerProps = {
  failed: boolean;
  filename: string;
  mediaUri?: string;
  onClose: () => void;
  onImageError: () => void;
  onSave: () => void;
  saveError: boolean;
  saving: boolean;
};

export function AttachmentImageViewer({ failed, filename, mediaUri, onClose, onImageError, onSave, saveError, saving }: AttachmentImageViewerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const palette = usePalette();

  const saveLabel = t(Platform.OS === 'web' ? 'chat:attachments.download' : 'chat:attachments.saveOrShare');

  return (
    <ModalSurface
      accessibilityLabel={filename}
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible
    >
      <GestureHandlerRootView style={styles.root}>
        <View testID="attachment-preview" accessibilityViewIsModal style={[styles.root, { backgroundColor: palette.background }]}>
          <View style={[styles.header, { paddingTop: insets.top, borderBottomColor: palette.border, backgroundColor: palette.surface }]}>
            <Button accessibilityLabel={t('common:actions.close')} onPress={onClose} size="icon" variant="ghost">
              <Icon color={palette.text} name="close" size={24} />
            </Button>
            <Text className={cn('text-foreground flex-1 px-2')} numberOfLines={1} variant="title">{filename}</Text>
            <Button
              accessibilityLabel={saveLabel}
              disabled={saving || failed || !mediaUri}
              onPress={onSave}
              size="icon"
              testID="attachment-save"
              variant="ghost"
            >
              {saving ? <Spinner size="small" /> : <Icon color={palette.text} name="download" size={22} />}
            </Button>
          </View>
          {saveError ? <Text accessibilityRole="alert" className={cn('text-destructive px-4 py-2')}>{t('chat:attachments.saveFailed')}</Text> : null}
          <View style={styles.viewport}>
            {failed ? (
              <View className={cn('flex-1 items-center justify-center px-6')}>
                <Text accessibilityRole="alert" className={cn('text-destructive text-center')}>{t('chat:attachments.previewFailed')}</Text>
              </View>
            ) : mediaUri ? (
              Platform.OS === 'web'
                ? <Image accessibilityLabel={filename} contentFit="contain" onError={onImageError} source={{ uri: mediaUri }} style={styles.image} testID="attachment-image-preview" />
                : <ZoomableImage filename={filename} mediaUri={mediaUri} onImageError={onImageError} />
            ) : (
              <View className={cn('flex-1 items-center justify-center')}><Spinner /></View>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </ModalSurface>
  );
}

function ZoomableImage({ filename, mediaUri, onImageError }: { filename: string; mediaUri: string; onImageError: () => void }) {
  const scale = useSharedValue(MIN_IMAGE_SCALE);
  const savedScale = useSharedValue(MIN_IMAGE_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const width = useSharedValue(1);
  const imageHeight = useSharedValue(1);

  const reset = () => {
    'worklet';
    scale.value = withTiming(MIN_IMAGE_SCALE, { duration: 120 });
    savedScale.value = MIN_IMAGE_SCALE;
    translateX.value = withTiming(0, { duration: 120 });
    translateY.value = withTiming(0, { duration: 120 });
    savedX.value = 0;
    savedY.value = 0;
  };

  const settle = () => {
    'worklet';
    savedScale.value = scale.value;
    if (scale.value <= MIN_IMAGE_SCALE + 0.01) {
      reset();
      return;
    }
    const x = clampImageTranslation(translateX.value, scale.value, width.value);
    const y = clampImageTranslation(translateY.value, scale.value, imageHeight.value);
    translateX.value = withTiming(x, { duration: 120 });
    translateY.value = withTiming(y, { duration: 120 });
    savedX.value = x;
    savedY.value = y;
  };

  const pinch = usePinchGesture({
    onUpdate: (event) => {
      'worklet';
      scale.value = clampImageScale(savedScale.value * event.scale);
    },
    onFinalize: () => {
      'worklet';
      settle();
    },
  });

  const pan = usePanGesture({
    averageTouches: true,
    minDistance: 6,
    maxPointers: 1,
    onUpdate: (event) => {
      'worklet';
      if (scale.value <= MIN_IMAGE_SCALE + 0.01) return;
      translateX.value = clampImageTranslation(savedX.value + event.translationX, scale.value, width.value);
      translateY.value = clampImageTranslation(savedY.value + event.translationY, scale.value, imageHeight.value);
    },
    onFinalize: () => {
      'worklet';
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      'worklet';
      const next = toggleImageScale(scale.value);
      if (next <= MIN_IMAGE_SCALE) {
        reset();
        return;
      }
      scale.value = withTiming(next, { duration: 120 });
      savedScale.value = next;
      translateX.value = withTiming(0, { duration: 120 });
      translateY.value = withTiming(0, { duration: 120 });
      savedX.value = 0;
      savedY.value = 0;
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(event) => {
          width.value = Math.max(1, event.nativeEvent.layout.width);
          imageHeight.value = Math.max(1, event.nativeEvent.layout.height);
        }}
        style={styles.viewport}
        testID="attachment-image-viewport"
      >
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Image accessibilityLabel={filename} contentFit="contain" onError={onImageError} source={{ uri: mediaUri }} style={styles.image} testID="attachment-image-preview" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: 1 },
  image: { width: '100%', height: '100%' },
  root: { flex: 1 },
  viewport: { flex: 1, overflow: 'hidden' },
});
