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
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Android release builds

The repository now includes a GitHub Action that builds a production Android bundle locally on the runner, without Expo EAS.

Required GitHub secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` for Play Store uploads

Recommended GitHub variables:

- `EXPO_OWNER`
- `EXPO_ANDROID_PACKAGE`
- `EXPO_IOS_BUNDLE_IDENTIFIER`

To build locally the same way as CI:

```bash
npm run build:android:local
```

This creates a signed release APK and AAB under `android/app/build/outputs/`.

The workflow in `.github/workflows/android-release.yml` also supports an optional manual upload to the Play Store internal track.

For Play Store uploads, create a workflow dispatch run with `upload_to_play_store` enabled and add the Google Play service account JSON secret.

## EAS builds

This project still includes `eas.json` and a tracked `app.config.ts` for teams that also use Expo tooling.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
