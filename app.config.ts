import { withAndroidManifest, withAppBuildGradle } from '@expo/config-plugins';
import type { ExpoConfig } from 'expo/config';

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const appVariant = env('EXPO_APP_VARIANT') ?? 'production';
const isDevelopmentVariant = appVariant === 'development';
const isE2EMode = env('EXPO_PUBLIC_E2E_MODE') === '1';
const e2eServerUrl = env('EXPO_PUBLIC_E2E_SERVER_URL');
const defaultAndroidPackage = 'app.getopencode';
const releaseAndroidPackage = env('EXPO_ANDROID_PACKAGE') ?? defaultAndroidPackage;
const developmentAndroidPackage = env('EXPO_ANDROID_PACKAGE_DEV') ?? `${releaseAndroidPackage}.dev`;
const androidPackage = isDevelopmentVariant ? developmentAndroidPackage : releaseAndroidPackage;
const androidReleaseBuildPropertiesPlugin: [string, { android: {
  enableMinifyInReleaseBuilds: boolean;
  enableShrinkResourcesInReleaseBuilds: boolean;
} }] = [
  'expo-build-properties',
  {
    android: {
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true,
    },
  },
];

const withAndroidAppConfig = (config: ExpoConfig) => {
  const withManifest = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return config;
  });

  if (isDevelopmentVariant) return withManifest;

  return withAppBuildGradle(withManifest, (config) => {
    const legacyFile = 'getDefaultProguardFile("proguard-android.txt")';
    const optimizedFile = 'getDefaultProguardFile("proguard-android-optimize.txt")';
    const contents = config.modResults.contents;

    if (contents.includes(optimizedFile)) return config;
    if (!contents.includes(legacyFile)) {
      throw new Error('Could not find the Android release ProGuard default file to enable R8 optimizations.');
    }

    config.modResults.contents = contents.replace(legacyFile, optimizedFile);
    return config;
  });
};

const config: ExpoConfig = {
  name: isDevelopmentVariant ? 'OpenCode Mobile Dev' : 'OpenCode Mobile',
  slug: 'opencode-mobile',
  version: '1.0.23',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'opencodemobile',
  userInterfaceStyle: 'automatic',
  android: {
    package: androidPackage,
    versionCode: 23,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: "#202020"
    },
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: 'resize',
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  ios: {
    bundleIdentifier: 'app.getopencode.mobile',
    buildNumber: '23',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription: 'Allow OpenCode Mobile to access photos you choose to attach to chat messages.',
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-notifications',
    'expo-background-task',
    'expo-web-browser',
    ...(isDevelopmentVariant ? [] : [androidReleaseBuildPropertiesPlugin]),
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow $(PRODUCT_NAME) to access the microphone for voice input.',
        speechRecognitionPermission: 'Allow $(PRODUCT_NAME) to convert speech to text on your device.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'],
      },
    ],
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
    'expo-image',
    'expo-secure-store',
    'expo-status-bar',
    withAndroidAppConfig as unknown as string,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    e2eMode: isE2EMode,
    e2eServerUrl,
  },
};

export default config;
