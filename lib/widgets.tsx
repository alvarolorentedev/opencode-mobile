import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { WidgetSnapshot } from '@/providers/widget-snapshot';
import { SESSION_WIDGET_NAME, SessionWidget } from '@/widgets/session-widget';

// Platform bridge for the Android home widget. The provider publishes a
// snapshot on confirmed state changes; this only repaints any placed widgets.
// iOS has no widget surface yet (see docs/ios-widget-parity.md), and web/E2E
// runs never call into the native module.
export const homeWidgetSupported = Platform.OS === 'android' && !Constants.expoConfig?.extra?.e2eMode;

export async function updateHomeWidget(snapshot: WidgetSnapshot | undefined) {
  if (!homeWidgetSupported) return;
  try {
    await requestWidgetUpdate({
      widgetName: SESSION_WIDGET_NAME,
      renderWidget: () => ({
        light: <SessionWidget scheme="light" snapshot={snapshot} />,
        dark: <SessionWidget scheme="dark" snapshot={snapshot} />,
      }),
    });
  } catch (error) {
    // A widget repaint failure is cosmetic; app state must be unaffected.
    console.warn('Could not update the home widget.', error);
  }
}
