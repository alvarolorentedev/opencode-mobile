import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { useCameraPermissions } from 'expo-camera';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

/**
 * Resolves camera permission before a requested scanner renders. Denial calls
 * onDenied, which defaults to returning to the caller's previous surface; a
 * caller that offers another input keeps its own surface. Web never requests
 * camera permission.
 */
export function ConnectCameraGate({ onCancel, onDenied = onCancel, children }: { onCancel: () => void; onDenied?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const native = Platform.OS === 'ios' || Platform.OS === 'android';
  const [permission] = useCameraPermissions({ request: native });
  useEffect(() => {
    if (native && permission && !permission.granted) onDenied();
  }, [native, onDenied, permission]);
  // A resolved denial still renders the caller's children: the scanner itself
  // stays blank until permission is granted.
  if (!native || permission) return <>{children}</>;
  return <View className={cn(stylesClasses.screen)}><Spinner accessibilityLabel={t('settings:connect.cameraLoading')} /></View>;
}

const stylesClasses = {
  "screen": "flex-1 items-center justify-center"
} as const;
