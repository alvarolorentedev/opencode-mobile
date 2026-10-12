import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { loadWidgetSnapshot } from '@/providers/widget-snapshot-storage';
import { SESSION_WIDGET_NAME, SessionWidget } from '@/widgets/session-widget';

// Headless entry registered from index.js before Expo Router. The widget task
// runs without the app UI (add, resize, update, reboot), so it renders the
// provider-written snapshot from storage and never touches the network or
// credentials. WIDGET_DELETED renders nothing; OPEN_APP/OPEN_URI clicks are
// handled natively by the widget library.
if (Platform.OS === 'android') {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetInfo.widgetName !== SESSION_WIDGET_NAME) return;
    if (widgetAction === 'WIDGET_DELETED') return;
    const snapshot = await loadWidgetSnapshot();
    renderWidget({
      light: <SessionWidget scheme="light" snapshot={snapshot} />,
      dark: <SessionWidget scheme="dark" snapshot={snapshot} />,
    });
  });
}
