import type { Preview } from '@storybook/react-vite';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PortalHost } from '@/shared/ui/portal';
import '@/global.css';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ACCENT_COLORS, DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from '@/shared/ui/theme/appearance';
import { getColors } from '@/shared/ui/theme/theme';
import { resources, TRANSLATION_NAMESPACES } from '@/shared/i18n/resources';
import { UpdatesContext } from '@/features/updates/context';
import type { UpdatesContextValue } from '@/features/updates/index';
import { AppearanceProvider } from '@/shared/ui/theme/appearance-context';

if (!i18n.isInitialized) {
  // eslint-disable-next-line import/no-named-as-default-member -- i18next exposes the instance plugin API on the default export
  void i18n.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    ns: TRANSLATION_NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
}

// UI-only fixture: previews exercise interaction blocking without running updates.
const noop = () => {};
const previewUpdates: UpdatesContextValue = {
  notice: undefined, busy: false, installing: false, error: false,
  supported: false, enabled: false, checkPeriod: 'available',
  update: async () => {}, later: noop, clearError: noop,
  block: () => noop, setSurfaceActive: noop, setEnabled: noop, setCheckPeriod: noop,
};

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'todo' },
  },
  initialGlobals: {
    scheme: 'light',
    accent: DEFAULT_ACCENT_COLOR,
  },
  globalTypes: {
    scheme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Scheme',
        icon: 'contrast',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    accent: {
      description: 'Accent preset',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: ACCENT_COLORS.map((accent) => ({ value: accent, title: accent })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const scheme = (context.globals.scheme ?? 'light') as ColorScheme;
      const accent = (context.globals.accent ?? DEFAULT_ACCENT_COLOR) as AccentColor;
      const palette = getColors(scheme, accent);
      return (
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
          <AppearanceProvider value={{ scheme, accent, palette }}>
            <UpdatesContext.Provider value={previewUpdates}>

              <View style={{ flex: 1, width: '100%', padding: 24, backgroundColor: palette.background }}>
                <Story />
                <PortalHost />
              </View>

                      </UpdatesContext.Provider>
          </AppearanceProvider>
                  </GestureHandlerRootView>
        </SafeAreaProvider>
      );
    },
  ],
};

export default preview;
