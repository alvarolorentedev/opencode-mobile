import type { Preview } from '@storybook/react-vite';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
  type AccentColor,
  type ColorScheme,
} from '@/constants/appearance';
import { getPaperTheme } from '@/constants/paper-theme';
import { getColors } from '@/constants/theme';
import { resources, TRANSLATION_NAMESPACES } from '@/lib/i18n/resources';
import { AppearanceProvider } from '@/providers/appearance-context';

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
          <AppearanceProvider value={{ scheme, accent, palette }}>
            <PaperProvider theme={getPaperTheme(scheme, accent)}>
              <View style={{ flex: 1, width: '100%', padding: 24, backgroundColor: palette.background }}>
                <Story />
              </View>
            </PaperProvider>
          </AppearanceProvider>
        </SafeAreaProvider>
      );
    },
  ],
};

export default preview;
