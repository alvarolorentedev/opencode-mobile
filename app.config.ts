import type { ExpoConfig } from 'expo/config';

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const androidPackage = env('EXPO_ANDROID_PACKAGE');

const config: ExpoConfig = {
  name: 'OpenCode Mobile',
  slug: 'opencode-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  splash: {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#202020"
  },
  icon: './assets/images/icon.png',
  scheme: 'opencodemobile',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  android: {
    package: androidPackage ?? 'app.getopencode.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: "#202020"
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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
  },
};

export default config;
