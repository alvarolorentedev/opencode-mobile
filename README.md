# OpenCode Mobile

Mobile client for OpenCode, built with Expo and React Native.

## Requirements

- Node.js 20+
- npm
- An OpenCode server you can connect to
- Android Studio / Xcode if you want local native builds

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run start
   ```

3. For a development client build, use:

   ```bash
   npm run start:dev-client
   ```

## Common Commands

```bash
npm run lint
npm run typecheck
npm run test:e2e:web
npm run android
npm run ios
```

## Testing

- Flow validation is CI-first and always runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`.
- The end-to-end suite is implemented with Playwright in `tests/e2e/flows.spec.mjs`.
- The full repo testing strategy is documented in `TESTING.md`.

## OpenCode Connection

Connection settings are configured inside the mobile app. By default the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local-only files such as `.env` and `config.json` are intentionally gitignored because they may contain secrets or tokens.

## Android Builds

Build a production Android release locally:

```bash
npm run build:android
```

Build an Android development client locally:

```bash
npm run build:development:android
```

Both local and GitHub Actions Android builds use the native `android/` project plus Gradle.

### GitHub Actions Secrets

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` for Play Store uploads

### GitHub Actions Variables

- `EXPO_ANDROID_PACKAGE`
- `EXPO_ANDROID_PACKAGE_DEV` optional; defaults to `<EXPO_ANDROID_PACKAGE>.dev`

The release workflow lives in `.github/workflows/android-release.yml`.
The development build workflow lives in `.github/workflows/expo-development-build.yml`.
