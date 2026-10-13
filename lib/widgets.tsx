import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { WidgetSnapshot } from '@/providers/widget-snapshot';
import { WIDGET_NAMES, SessionWidget, widgetKind } from '@/widgets/session-widget';

// Platform bridge for the Android home widget. The provider publishes a
// snapshot on confirmed state changes; this only repaints any placed widgets.
// iOS has no widget surface yet (see docs/ios-widget-parity.md), and web/E2E
// runs never call into the native module.
export const homeWidgetSupported = Platform.OS === 'android' && Constants.appOwnership !== 'expo' && !Constants.expoConfig?.extra?.e2eMode;

export async function updateHomeWidget(snapshot: WidgetSnapshot | undefined) {
  if (!homeWidgetSupported) return;
  try {
    await Promise.all(WIDGET_NAMES.map((widgetName) => requestWidgetUpdate({
      widgetName,
      renderWidget: ({ height }) => ({
        light: <SessionWidget scheme="light" snapshot={snapshot} kind={widgetKind(widgetName)} height={height} />,
        dark: <SessionWidget scheme="dark" snapshot={snapshot} kind={widgetKind(widgetName)} height={height} />,
      }),
    })));
  } catch (error) {
    // A widget repaint failure is cosmetic; app state must be unaffected.
    console.warn('Could not update the home widget.', error);
  }
}
