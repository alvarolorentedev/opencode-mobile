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
  extraProguardRules: string;
} }] = [
  'expo-build-properties',
  {
    android: {
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true,
      // Expo modules convert JS objects into native records through the Pika
      // introspection runtime and generated `$__Pika` classes, and load the
      // headless app loader by class name. R8 sees no direct references and strips
      // them, which crashed nested records (speech recognition's
      // volumeChangeEventOptions -> NullPointerException) and the headless loader
      // (ClassNotFoundException) in release builds. Costs ~33 KB of APK size.
      extraProguardRules: [
        '-keep class **$__Pika { *; }',
        '-keep class io.github.lukmccall.pika.** { *; }',
        '-keep class * implements io.github.lukmccall.pika.Introspectable { *; }',
        '-keep class expo.modules.kotlin.records.** { *; }',
        '-keep class expo.modules.adapters.react.apploader.** { *; }',
      ].join('\n'),
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
  version: '1.0.34',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'opencodemobile',
  userInterfaceStyle: 'automatic',
  android: {
    package: androidPackage,
    versionCode: 34,
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
    buildNumber: '34',
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
    [
      // Exposes the shipped app languages to the OS so iOS/Android surface the
      // correct per-app language choices. Extend both lists with every language
      // added under lib/i18n/locales.
      'expo-localization',
      {
        supportedLocales: {
          ios: ['en', 'es', 'hi', 'de', 'fr', 'zh', 'pt', 'ja'],
          android: ['en', 'es', 'hi', 'de', 'fr', 'zh', 'pt', 'ja'],
        },
      },
    ],
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
