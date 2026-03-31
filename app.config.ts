import type { ExpoConfig } from 'expo/config';

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const iosBundleIdentifier = env('EXPO_IOS_BUNDLE_IDENTIFIER');
const androidPackage = env('EXPO_ANDROID_PACKAGE');
const easProjectId = env('EXPO_EAS_PROJECT_ID') ?? 'd9362b8b-45e8-4158-9ac5-fe644b4447c3';
const expoOwner = env('EXPO_OWNER') ?? 'alvarolorentedev';

const config: ExpoConfig = {
  name: 'OpenCode Mobile',
  slug: 'opencode-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'opencodemobile',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    // Provide a stable bundle identifier so EAS can run non-interactive builds.
    bundleIdentifier: iosBundleIdentifier ?? 'app.getopencode.mobile',
    infoPlist: {
      NSUserNotificationUsageDescription: 'OpenCode Mobile sends notifications when a task finishes.',
    },
  },
  android: {
    // Provide a stable android package so EAS can run non-interactive builds.
    package: androidPackage ?? 'app.getopencode.mobile',
    adaptiveIcon: {
      backgroundColor: '#1F1D1C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    'expo-background-task',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: easProjectId,
    },
  },
  owner: expoOwner,
};

export default config;
