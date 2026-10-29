import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getWidgetInfo, requestWidgetUpdateById } from 'react-native-android-widget';

import type { WidgetSnapshot } from '@/providers/widget-snapshot';
import { WIDGET_NAMES, SessionWidget, widgetKind } from '@/widgets/session-widget';

// Platform bridge for the Android home widget. The provider publishes a
// snapshot on confirmed state changes; this only repaints any placed widgets.
// iOS has no widget surface yet (see docs/product/parity/ios-widget.md), and web/E2E
// runs never call into the native module.
export const homeWidgetSupported = Platform.OS === 'android' && Constants.appOwnership !== 'expo' && !Constants.expoConfig?.extra?.e2eMode;

export async function updateHomeWidget(snapshot: WidgetSnapshot | undefined) {
  if (!homeWidgetSupported) return;
  await Promise.all(WIDGET_NAMES.map(async (widgetName) => {
    try {
      const widgets = await getWidgetInfo(widgetName);
      // The library's bulk updater uses an unawaited async forEach.
      await Promise.all(widgets.map(({ widgetId }) => requestWidgetUpdateById({
        widgetName, widgetId,
        renderWidget: ({ height }) => ({
          light: <SessionWidget scheme="light" snapshot={snapshot} kind={widgetKind(widgetName)} height={height} />,
          dark: <SessionWidget scheme="dark" snapshot={snapshot} kind={widgetKind(widgetName)} height={height} />,
        }),
      }).catch((error) => {
        console.warn('Could not update the home widget.', widgetName, widgetId, error);
      })));
    } catch (error) {
      // Native widget failures must not interrupt the provider's publish queue.
      console.warn('Could not list the home widgets.', widgetName, error);
    }
  }));
}
