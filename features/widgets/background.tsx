import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { loadWidgetSnapshot } from '@/features/widgets/services/widget-snapshot-storage';
import { WIDGET_NAMES, SessionWidget, widgetKind } from '@/features/widgets/ui/session-widget';

// Headless entry registered from index.js before Expo Router. The widget task
// runs without the app UI (add, resize, update, reboot), so it renders the
// provider-written snapshot from storage and never touches the network or
// credentials. WIDGET_DELETED renders nothing; OPEN_APP/OPEN_URI clicks are
// handled natively by the widget library.
if (Platform.OS === 'android') {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (!WIDGET_NAMES.some((name) => name === widgetInfo.widgetName)) return;
    if (widgetAction === 'WIDGET_DELETED') return;
    const snapshot = await loadWidgetSnapshot();
    renderWidget({
      light: <SessionWidget scheme="light" snapshot={snapshot} kind={widgetKind(widgetInfo.widgetName)} height={widgetInfo.height} />,
      dark: <SessionWidget scheme="dark" snapshot={snapshot} kind={widgetKind(widgetInfo.widgetName)} height={widgetInfo.height} />,
    });
  });
}
