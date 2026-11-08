import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getWidgetInfo, requestWidgetUpdateById } from 'react-native-android-widget';

import type { WidgetSnapshot } from '@/shared/contracts/widget-snapshot';
import type { MissionWidgetSnapshot } from '@/shared/contracts/mission-control';
import { MISSION_WIDGET_NAME, MissionWidget, WIDGET_NAMES, SessionWidget, widgetKind } from '@/features/widgets/ui/session-widget';

// Platform bridge for the Android home widget. The provider publishes a
// snapshot on confirmed state changes; this only repaints any placed widgets.
// iOS has no widget surface yet (see docs/product/parity/ios-widget.md), and web/E2E
// runs never call into the native module.
export const homeWidgetSupported = Platform.OS === 'android' && Constants.appOwnership !== 'expo' && !Constants.expoConfig?.extra?.e2eMode;

export async function updateHomeWidget(snapshot: WidgetSnapshot | undefined) {
  await repaintWidgets(WIDGET_NAMES, (name, height) => ({
    light: <SessionWidget scheme="light" snapshot={snapshot} kind={widgetKind(name)} height={height} />,
    dark: <SessionWidget scheme="dark" snapshot={snapshot} kind={widgetKind(name)} height={height} />,
  }));
}

export async function updateMissionWidget(snapshot: MissionWidgetSnapshot | undefined) {
  await repaintWidgets([MISSION_WIDGET_NAME], () => ({
    light: <MissionWidget scheme="light" snapshot={snapshot} />, dark: <MissionWidget scheme="dark" snapshot={snapshot} />,
  }));
}

async function repaintWidgets(names: readonly string[], render: (name: string, height: number) => { light: React.JSX.Element; dark: React.JSX.Element }) {
  if (!homeWidgetSupported) return;
  await Promise.all(names.map(async (widgetName) => {
    try {
      const widgets = await getWidgetInfo(widgetName);
      // The library's bulk updater uses an unawaited async forEach.
      await Promise.all(widgets.map(({ widgetId }) => requestWidgetUpdateById({
        widgetName, widgetId,
        renderWidget: ({ height }) => render(widgetName, height),
      }).catch((error) => {
        console.warn('Could not update the home widget.', widgetName, widgetId, error);
      })));
    } catch (error) {
      // Native widget failures must not interrupt the provider's publish queue.
      console.warn('Could not list the home widgets.', widgetName, error);
    }
  }));
}
