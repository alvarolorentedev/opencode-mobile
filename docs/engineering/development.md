# Development

OpenCode Mobile is built with Expo and React Native.

### Requirements

- Node.js 22.13+ (the range in `package.json` `engines` is authoritative; `.nvmrc` pins 22)
- npm
- Android Studio / Xcode for native builds

The unit suite runs under Vitest 5, which requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`. Older Node versions will fail to start the test runner.

> If the working tree lives on a shared or network drive, macOS may leave `._*` AppleDouble sidecar files behind. They are gitignored, but delete them before copying the tree to a build/test mirror so they never reach a bundle or native project.

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
   never app configuration. See [Cloud Link prerequisites and validation](../product/cloud-link.md).

### Optional local agent tooling

Expo publishes official AI agent skills for generic Expo and React Native work
(`npx skills add expo/skills --global --agent codex`, or the official Expo plugin for Claude Code / Codex). They
complement this repository's `AGENTS.md`, design system, and fake-server
contract; when generic advice conflicts with the repo docs, the repo wins. Do
not vendor the skills or add them as project dependencies.

For native work, use Expo's `expo-overview`, `expo-upgrade`, `expo-module` and
`expo-dev-client` skills as applicable. Discover libraries in the versioned SDK
58 documentation and Expo's bundled dependency mapping. Install native packages
with `npx expo install`, review their config plugins and FOSS impact, then use
`npx expo install --check` and `npx expo-doctor`. Do not upgrade unrelated SDKs or
tools, force peer resolution, or edit generated native projects as the solution.

The optional Expo MCP endpoint is `https://mcp.expo.dev/mcp` (OAuth). The official
Expo plugin registers it; otherwise follow the [official MCP setup](https://docs.expo.dev/mcp/).
The development-only `expo-mcp` package remains disabled unless the developer
starts Expo with `EXPO_UNSTABLE_MCP_SERVER=1`. Local capabilities require Expo CLI
and MCP to authenticate with the same Expo account. Normal development and CI commands
do not set that flag. Local capabilities send inspected data through Expo's remote
service: use synthetic accounts/data and keep credentials out of captures.

Direct tools remain the fallback: use the existing Android/iOS build commands,
the first failing Gradle task with `--stacktrace`, dependency inspection,
`adb logcat`, and Xcode's build log/signing diagnostics. Rebuild the development
client after native changes. Simulator/MCP evidence cannot replace physical-device
voice/keyboard acceptance, signed store-update tests or release/FOSS builds. See
the [validation matrix](validation/strategy.md) and [native ownership](../../modules/AGENTS.md).

### Common Commands

```bash
npm run lint           # Run linter
npm run typecheck      # Type checking
npm run test:e2e:web   # End-to-end tests
npm run storybook      # Open the reusable component catalog
npm run build:storybook # Build-check the Storybook catalog
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
also exposes Cloud Link subscriptions. See [Cloud Link](../product/cloud-link.md) for native store,
trusted environment, and sandbox configuration. See
[F-Droid and FOSS builds](./fdroid.md) for the FOSS variant's scope and distribution.

**Release Automation**:
- Pushes to `main` run the full validation gate; documentation-only pushes run static checks only. Tag pushes do not trigger builds, so `main` and its tag can be pushed together
- A `v*` tag at the validated commit marks a release. When the green `Build` run for that commit completes, the **Release** workflow (`.github/workflows/release.yml`) checks that the tag matches `app.config.ts`, creates a draft GitHub Release once, and builds Android and FOSS in parallel
- Push the tag with the release commit so it exists when the green run completes. A tag added afterwards needs a manual **Release** dispatch
- The workflow attaches both APKs to the draft and publishes it only after both uploads succeed. A failed build leaves an unpublished draft instead of a released empty release
- Manual **Release** dispatch: pass `tag` and set `publish: true` to repair or rebuild a release; pass no tag (or `publish: false`) to build sideload APKs without touching a release. `upload_to_store: true` also pushes the AAB to the Play internal track; green-main releases do that automatically. `Build` keeps a `force_validate` dispatch for emergency full validation
- Release builds upload APKs as `android-release-artifacts` and `foss-release-artifacts` (1-day retention); published releases also build the release AAB for the Play Store upload
- Release ABIs are trimmed per mode: tagged builds use `armeabi-v7a,arm64-v8a`, including build-only runs used for device acceptance before publication; untagged build-only runs use `arm64-v8a,x86_64`. Override locally with `ANDROID_RELEASE_ABIS`. See [Android Build / Release Notes](./integrations-and-operations.md#release-abis-and-gradle-memory)

### iOS Builds

For a free Apple Personal Team development build, choose a bundle identifier
that is unique to your Apple account and pass it to the helper command:

```bash
EXPO_IOS_BUNDLE_ID=com.example.yourname.opencode npm run ios:personal-team -- --device
```

The helper removes only the `aps-environment` entitlement that Personal Teams
cannot provision. This local build cannot receive push notifications. Ordinary
iOS, CI, and paid-team builds keep the configured bundle identifiers and push
entitlement because the opt-out is unset.

Build a local iOS release:
```bash
npm run build:ios:local
```

**Release Automation** (`.github/workflows/ios-release.yml`, manual only):
- Run the **iOS Release** workflow via `workflow_dispatch`; pass a `tag` (e.g. `v1.0.51`) or leave it blank to use the latest `v*` tag, then it runs the validate gate against that tag and builds and signs the archive
- It ignores the ref selected when dispatching; the resolved tag is validated against the app version and the GitHub Release asset is published for it, while the `.ipa` is uploaded as the `ios-release-ipa` artifact (1-day retention)
- Set `upload_to_store: true` to upload to App Store Connect (TestFlight)
- The pipeline never runs on push or tag, so routine Android releases don't trigger a macOS build
- The `.ipa` artifact can be found in the workflow run's artifacts section

### Testing

- `npm run test:ci:static` runs lint, app type-checking, the typed-test
  type-check (`npm run typecheck:tests`, via `tsconfig.tests.json`), and the
  Vitest suites (`tests/vitest/`)
- Flow validation runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`
- End-to-end suite uses Playwright (`tests/e2e/*.spec.mjs`, split by domain over `tests/e2e/helpers/flows.mjs`)
- `npm run test:e2e:smoke` runs the 17 critical flows; `npm run test:e2e:changed`
  selects smoke plus the specs affected by the current diff; `npm run test:e2e:web:isolated`
  allocates fresh ports for concurrent local runs; `npm run validate:fast` is the
  pre-push loop
- CI runs the Playwright suite in one job with four workers, each with its own
  fake V1/V2 pair, resets the worker backend before every test, and caches the
  browser and static-check state; PRs run a risk-based slice while `main` runs
  the full suite
- Full testing strategy documented in `docs/engineering/testing-overview.md`; remaining deferred test work in `docs/engineering/known-gaps.md`

### Configuration

Connection settings are configured inside the app. By default, the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local configuration files (`.env`, `config.json`) are gitignored for security.

### Store update configuration

Android Play updates use immediate-only `expo-in-app-updates` and require a signed Play-installed
production app for runtime validation. FOSS excludes the package. iOS is disabled
until the verified public listing ID is supplied as `EXPO_IOS_APP_STORE_ID`;
`EXPO_IOS_APP_STORE_COUNTRY` is optional. See [app updates](../product/app-updates.md).
