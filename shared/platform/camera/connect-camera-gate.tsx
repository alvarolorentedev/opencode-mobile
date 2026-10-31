import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { useCameraPermissions } from 'expo-camera';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

/**
 * Resolves camera permission before a requested scanner renders. Denial returns
 * to the caller's previous surface. Web never requests camera permission.
 */
export function ConnectCameraGate({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const native = Platform.OS === 'ios' || Platform.OS === 'android';
  const [permission] = useCameraPermissions({ request: native });
  useEffect(() => {
    if (native && permission && !permission.granted) onCancel();
  }, [native, onCancel, permission]);
  if (!native || permission?.granted) return <>{children}</>;
  return <View className={cn(stylesClasses.screen)}><Spinner accessibilityLabel={t('settings:connect.cameraLoading')} /></View>;
}

const stylesClasses = {
  "screen": "flex-1 items-center justify-center"
} as const;
