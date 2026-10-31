const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const pkg = require('./package.json');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// The FOSS (F-Droid) build excludes the native expo-iap and expo-camera
// modules from autolinking (see package.json `expo.autolinking.exclude`, set by
// scripts/build-android-release.mjs or the fdroiddata recipe). Importing either
// package loads a native module that is absent in this build, so redirect their
// JS entrypoints to local stubs. Cloud Link is disabled at runtime for FOSS, so
// the stubs are never exercised.
const fossExcludes = pkg.expo?.autolinking?.exclude ?? [];
const isFossBuild = process.env.EXPO_PUBLIC_FOSS === '1' || fossExcludes.includes('expo-iap');

if (isFossBuild) {
  const stubs = {
    'expo-iap': path.resolve(__dirname, 'shared/platform/foss/expo-iap-stub.ts'),
    'expo-camera': path.resolve(__dirname, 'shared/platform/foss/expo-camera-stub.tsx'),
    'expo-store-review': path.resolve(__dirname, 'shared/platform/foss/expo-store-review-stub.ts'),
  };
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const stub = stubs[moduleName];
    if (stub) {
      return context.resolveRequest(context, stub, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = withUniwindConfig(config, { cssEntryFile: './global.css', dtsFile: './uniwind-types.d' });
