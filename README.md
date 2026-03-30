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

## EAS builds

This project includes a basic `eas.json` and a tracked `app.config.ts` so it can build with Expo Application Services without committing machine-specific app identifiers.

Copy `.env.example` to `.env` and fill in the values Expo should inject into the config:

```bash
EXPO_OWNER=alvarolorentedev
EXPO_EAS_PROJECT_ID=your-eas-project-id
EXPO_IOS_BUNDLE_IDENTIFIER=com.example.opencodemobile
EXPO_ANDROID_PACKAGE=com.example.opencodemobile
```

1. Install the Expo tooling if needed:

   ```bash
   npm install
   npm install -g eas-cli
   ```

2. Log in and link the project:

   ```bash
   eas login
   eas init
   ```

3. Add the values from `eas init` and your native app identifiers to `.env`:

   - `EXPO_EAS_PROJECT_ID`
   - `EXPO_ANDROID_PACKAGE`
   - `EXPO_IOS_BUNDLE_IDENTIFIER`

4. Run a build:

   ```bash
   npm run build:android
   npm run build:ios
   ```

For internal test builds, use `npm run build:preview:android` or `npm run build:preview:ios`.

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
