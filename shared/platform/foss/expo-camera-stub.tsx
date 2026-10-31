import React from 'react';
import { View } from 'react-native';

export function CameraView(_props: Record<string, unknown>) {
  return React.createElement(View, null);
}

export function useCameraPermissions() {
  return [{ granted: false, canAskAgain: false, status: 'undetermined' as const }, async () => undefined];
}
