# Development

OpenCode Mobile is built with Expo and React Native.

### Requirements

- Node.js 20+
- npm
- Android Studio / Xcode for native builds

### Getting Started

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/alvarolorentedev/opencode-mobile.git
   cd opencode-mobile
   npm install
   ```

2. Start the development server:
   ```bash
   npm run start
   ```

3. For a development client build:
   ```bash
   npm run start:dev-client
   ```

   Native Cloud Link is available in every build. Purchase/Restore requires a native
   development or store build, not Expo Go. Use
   `EXPO_APP_VARIANT=development npm run start:dev-client` for the separate dev app.
   Cloud Link routes real purchases to `https://api.opencodecloud.link` and test purchases
   to `https://apistaging.opencodecloud.link` automatically. No manual URL configuration
   is needed. The resolved environment survives relaunch. Products come from its backend catalog,
   never app configuration. See [Cloud Link prerequisites and validation](connect.md).

### Common Commands

```bash
npm run lint           # Run linter
npm run typecheck      # Type checking
npm run test:e2e:web   # End-to-end tests
npm run android        # Build Android app
npm run ios            # Build iOS app
npm run prebuild:ios   # Generate iOS native project
npm run build:ios:local # Build iOS release archive locally
```

### Android Builds

Build a production Android release:
```bash
npm run build:android
```

Build a development client:
```bash
npm run build:development:android
```

Build the de-Googled FOSS variant (published to F-Droid; excludes Play Billing,
ML Kit barcode scanning, and Firebase Cloud Messaging):
```bash
npm run build:foss:android
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` (**OpenCode Mobile
Dev**) and use `EXPO_APP_VARIANT=development npm run start:dev-client`. Both prebuild and Gradle use the
development variant. The APK built from a push to `main` uses production and
also exposes Cloud Link subscriptions. See [Cloud Link](connect.md) for native store,
trusted environment, and sandbox configuration. See
[F-Droid and FOSS builds](fdroid.md) for the FOSS variant's scope and distribution.

**Release Automation**:
- Every CI run (push to `main`, tags, manual dispatch) builds the Android release and uploads it as the `android-release-artifacts` artifact
- The GitHub Release asset and production Play Store upload happen only on `v*` tags
- Release ABIs are trimmed per ref: `v*` tags build `armeabi-v7a,arm64-v8a`; other builds build `arm64-v8a` only. Override locally with `ANDROID_RELEASE_ABIS`. See [Android Build / Release Notes](integrations-and-operations.md#release-abis-and-gradle-memory)

### iOS Builds

Build a local iOS release:
```bash
npm run build:ios:local
```

**Release Automation** (`.github/workflows/ios-release.yml`, manual only):
- Run the **iOS Release** workflow via `workflow_dispatch`; pass a `tag` (e.g. `v1.0.51`) or leave it blank to use the latest `v*` tag, then it runs the validate gate against that tag and builds and signs the archive
- It ignores the ref selected when dispatching; the resolved tag is validated against the app version and the GitHub Release asset is published for it, while the `.ipa` is uploaded as the `ios-release-ipa` artifact
- Set `upload_to_store: true` to upload to App Store Connect (TestFlight)
- The pipeline never runs on push or tag, so routine Android releases don't trigger a macOS build
- The `.ipa` artifact can be found in the workflow run's artifacts section

### Testing

- Flow validation runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`
- End-to-end suite uses Playwright (`tests/e2e/flows.spec.mjs`)
- Full testing strategy documented in `TESTING.md`

### Configuration

Connection settings are configured inside the app. By default, the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local configuration files (`.env`, `config.json`) are gitignored for security.

### Store update configuration

Android Play updates use the local Expo module and require a signed Play-installed
production app for runtime validation. FOSS excludes the module. iOS is disabled
until the verified public listing ID is supplied as `EXPO_IOS_APP_STORE_ID`;
`EXPO_IOS_APP_STORE_COUNTRY` is optional. See [app updates](app-updates.md).
