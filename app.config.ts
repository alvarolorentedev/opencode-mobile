import type { ExpoConfig } from 'expo/config';

// Expo's config loader executes the compiled app.config.js through Node, so the
// platform plugin modules stay CommonJS rather than relying on a TS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidAppConfig } = require('./config/plugins/android.cjs') as {
  withAndroidAppConfig: (
    config: ExpoConfig,
    options: { isDevelopmentVariant: boolean; isFossVariant: boolean },
  ) => ExpoConfig;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withoutPushEntitlement } = require('./config/plugins/ios.cjs') as {
  withoutPushEntitlement: (config: ExpoConfig) => ExpoConfig;
};

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const appVariant = env('EXPO_APP_VARIANT') ?? 'production';
const isDevelopmentVariant = appVariant === 'development';
const isFossVariant = appVariant === 'foss' || env('EXPO_PUBLIC_FOSS') === '1';
const isE2EMode = env('EXPO_PUBLIC_E2E_MODE') === '1';
const e2eServerUrl = env('EXPO_PUBLIC_E2E_SERVER_URL');
// Free Apple "Personal Team" accounts cannot provision the Push Notifications
// capability, so `expo-notifications`'s aps-environment entitlement blocks
// on-device builds entirely for them. Strip it locally with this flag; CI and
// paid-team builds must leave it unset so push notifications keep working.
const disablePushEntitlement = env('EXPO_IOS_DISABLE_PUSH_ENTITLEMENT') === '1';
// Apple bundle identifiers are unique across every developer account, not just
// per team. The published "app.getopencode.mobile" (and its ".dev" variant)
// are already registered to the paid team, so a free "Personal Team" account
// can never register them. Override with a bundle id nobody else has claimed.
const iosBundleIdentifierOverride = env('EXPO_IOS_BUNDLE_ID');
const defaultAndroidPackage = isFossVariant ? 'app.getopencode.fdroid' : 'app.getopencode';
const releaseAndroidPackage = env('EXPO_ANDROID_PACKAGE') ?? defaultAndroidPackage;
const developmentAndroidPackage = env('EXPO_ANDROID_PACKAGE_DEV') ?? `${releaseAndroidPackage}.dev`;
const androidPackage = isDevelopmentVariant ? developmentAndroidPackage : releaseAndroidPackage;
const buildPropertiesPlugin: [string, {
  android?: {
    enableMinifyInReleaseBuilds: boolean;
    enableShrinkResourcesInReleaseBuilds: boolean;
    extraProguardRules: string;
  };
  ios: { enableSceneSupport: boolean };
}] = [
  'expo-build-properties',
  {
    ios: { enableSceneSupport: true },
    ...(!isDevelopmentVariant ? { android: {
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true,
      // Expo modules convert JS objects into native records through the Pika
      // introspection runtime and generated `$__Pika` classes, and load the
      // headless app loader by class name. R8 sees no direct references and strips
      // them, which crashed nested records (speech recognition's
      // volumeChangeEventOptions -> NullPointerException) and the headless loader
      // (ClassNotFoundException) in release builds. Costs ~33 KB of APK size.
      // WorkManager also constructs the widget library's headless worker
      // reflectively, so keep it and its base class for the same reason.
      extraProguardRules: [
        '-keep class **$__Pika { *; }',
        '-keep class io.github.lukmccall.pika.** { *; }',
        '-keep class * implements io.github.lukmccall.pika.Introspectable { *; }',
        '-keep class expo.modules.kotlin.records.** { *; }',
        '-keep class expo.modules.adapters.react.apploader.** { *; }',
        '-keep class com.reactnativeandroidwidget.RNWidgetBackgroundTaskWorker { *; }',
        '-keep class com.reactnativeandroidwidget.oss.HeadlessJsTaskWorker { *; }',
      ].join('\n'),
    } } : {}),
  },
];

// The F-Droid/FOSS build drops the proprietary expo-camera (ML Kit barcode
// scanning) and expo-iap (Google Play Billing) plugins. Typed constants keep
// the tuple shape so `plugins` stays assignable to ExpoConfig.
type PluginList = NonNullable<ExpoConfig['plugins']>;
const cameraPlugin: PluginList = [['expo-camera', {
  cameraPermission: 'Allow $(PRODUCT_NAME) to scan an OpenCode pairing QR code.',
  recordAudioAndroid: false,
}]];
const iapPlugin: PluginList = ['expo-iap'];

const config: ExpoConfig = {
  name: isDevelopmentVariant ? 'OpenCode Mobile Dev' : 'OpenCode Mobile',
  slug: 'opencode-mobile',
  version: '1.0.101',
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme: 'opencodemobile',
  userInterfaceStyle: 'automatic',
  android: {
    package: androidPackage,
    versionCode: 101,
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
    bundleIdentifier: iosBundleIdentifierOverride ?? (isDevelopmentVariant ? 'app.getopencode.mobile.dev' : 'app.getopencode.mobile'),
    buildNumber: '101',
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
    // Config-plugin mods compose in reverse of registration order (last
    // registered runs first), so this must be registered before
    // expo-notifications to run after it and strip the entitlement it sets.
    ...(disablePushEntitlement ? [withoutPushEntitlement as unknown as string] : []),
    'expo-notifications',
    'expo-background-task',
    'expo-web-browser',
    [
      // Receiving shares into the app. Android share intents are enabled here;
      // the iOS Share Extension is deferred and tracked in
      // docs/ios-share-parity.md. The JS side stages payloads in
      // providers/use-share-state.ts and previews them in app/share.tsx.
      'expo-sharing',
      {
        android: {
          enabled: true,
          singleShareMimeTypes: ['*/*'],
          multipleShareMimeTypes: ['*/*'],
        },
      },
    ],
    ...(isFossVariant ? [] : cameraPlugin),
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
    buildPropertiesPlugin,
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow $(PRODUCT_NAME) to access the microphone for voice input.',
        speechRecognitionPermission: 'Allow $(PRODUCT_NAME) to convert speech to text on your device.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'],
      },
    ],
    // Optional on-device wake word and speaker models (sherpa-onnx). The
    // Android config plugin adds the ONNX Runtime packaging rule; iOS is
    // autolinked. Models are downloaded from the user's explicit action.
    '@siteed/sherpa-onnx.rn',
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
    'expo-video',
    'expo-secure-store',
    ...(isFossVariant ? [] : iapPlugin),
    'expo-status-bar',
    [
      // Android home-screen widget. Widget trees and the headless task handler
      // live in widgets/; the provider publishes snapshots on confirmed state
      // changes (providers/use-widget-state.ts). The picker label and
      // description are written to strings.xml as non-translatable by the
      // plugin, so they stay English. iOS has no widget surface yet; see
      // docs/ios-widget-parity.md. The library is MIT-licensed and pure
      // Android, so the FOSS variant keeps it.
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'SessionWidget',
            label: 'OpenCode latest replies',
            description: 'Latest assistant replies across recent chats.',
            minWidth: '180dp',
            minHeight: '140dp',
            targetCellWidth: 4,
            targetCellHeight: 3,
            resizeMode: 'horizontal|vertical',
          },
          {
            name: 'AttentionWidget', label: 'OpenCode awaiting actions',
            description: 'Pending permissions and questions across projects.',
            minWidth: '180dp', minHeight: '140dp', targetCellWidth: 4, targetCellHeight: 3,
            resizeMode: 'horizontal|vertical',
          },
          {
            name: 'PlanWidget', label: 'OpenCode plan progress',
            description: 'Todo steps and progress in the current chat.',
            minWidth: '180dp', minHeight: '140dp', targetCellWidth: 4, targetCellHeight: 3,
            resizeMode: 'horizontal|vertical',
          },
        ],
      },
    ],
    ((config: ExpoConfig) => withAndroidAppConfig(config, { isDevelopmentVariant, isFossVariant })) as unknown as string,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    e2eMode: isE2EMode,
    e2eServerUrl,
    foss: isFossVariant,
    updates: {
      enabled: !isDevelopmentVariant && !isFossVariant && !isE2EMode,
      testing: isDevelopmentVariant && isE2EMode,
      appStoreId: env('EXPO_IOS_APP_STORE_ID'),
      appStoreCountry: env('EXPO_IOS_APP_STORE_COUNTRY'),
    },
    connectPilot: {
      testing: isDevelopmentVariant && isE2EMode,
    },
  },
};

export default config;
