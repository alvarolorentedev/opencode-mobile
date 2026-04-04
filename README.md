# OpenCode Mobile

Mobile client for OpenCode, built with Expo.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Android release builds

The repository now includes a GitHub Action that builds a production Android bundle locally on the runner.

Required GitHub secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` for Play Store uploads

Recommended GitHub variables:

- `EXPO_ANDROID_PACKAGE`

To build locally the same way as CI:

```bash
npm run build:android
```

This creates a signed release APK and AAB under `android/app/build/outputs/`.

The workflow in `.github/workflows/android-release.yml` also supports an optional manual upload to the Play Store internal track.

For Play Store uploads, create a workflow dispatch run with `upload_to_play_store` enabled and add the Google Play service account JSON secret.

## Development builds

- Android release build:
  - `npm run build:android`
- Android development client build that stays connected to a live Metro server:
  - `npm run build:development:android`
  - Then start Metro with `npm run start:dev-client`.
  - If you use the Cloudflare tunnel workflow, start it with `npm run start:cloudflare:dev-client`.

## Manual Android development build

There is also a manual GitHub Action at `.github/workflows/expo-development-build.yml` that builds an Android development APK locally on GitHub Actions.

Recommended GitHub variables:

- `EXPO_ANDROID_PACKAGE`

The repository no longer depends on EAS Build. Both release and development Android builds run in GitHub Actions with `expo prebuild` plus Gradle, so no `EXPO_TOKEN` or `eas.json` is needed.

After installing the generated development APK on a device or emulator, open it against a running Metro server from `npm run start:dev-client` (or `npm run start:cloudflare:dev-client` for the tunneled setup) so it keeps loading live code from the dev server instead of a bundled production update.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial for building with Expo.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
