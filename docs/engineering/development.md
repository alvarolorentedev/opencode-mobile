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
npm run test:e2e:smoke # Critical Playwright flows
npm run test:e2e:web   # Full end-to-end suite
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
development variant. Release APKs are built by the `v*` tag workflow and also
expose Cloud Link subscriptions. See [Cloud Link](../product/cloud-link.md) for native store,
trusted environment, and sandbox configuration. See
[F-Droid and FOSS builds](./fdroid.md) for the FOSS variant's scope and distribution.

**Release Automation** (`.github/workflows/release.yml`):
- Pushes to `main` and pull requests run `ci.yml`: static checks, Vitest/architecture, fake-server validation, Storybook, FOSS preparation and critical Playwright smoke flows
- A `v*` tag push runs `release.yml` automatically. It verifies the tag, `app.config.ts` version, Android versionCode, iOS buildNumber and changelog; requires the tag commit to belong to `main`; runs full validation once; and builds Android Play, FOSS Android and signed iOS in parallel. The Play changelog (`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`) must stay within Google Play's 500-character release-notes limit or distribution fails
- Android release artifacts are **`arm64-v8a` only**. 32-bit-only Android devices are unsupported. There is no ABI override or emulator-specific release build
- Validated Android builds upload to Google Play **internal testing**; the signed IPA uploads to **TestFlight** when App Store Connect API credentials are configured
- The GitHub Release is created as a draft only after validation, builds and store uploads succeed, then published with the APKs, IPA, AAB, mapping and SHA256SUMS.txt
- Nothing is automatically promoted to a production store track. `workflow_dispatch` is recovery-only and requires an existing tag
- Google Play in-app update priority is set from the optional `update_priority` input (0–5, default `0`) and sent as `inAppUpdatePriority` with the existing internal-track upload. Automatic tag releases use `0`, which keeps updates flexible. Manual dispatches may pass `4` or `5` for an emergency release that uses Play's immediate flow. The value is validated before upload and recorded in the job summary
- Static release verification covers signing, package identity, version, ABI, native libraries, R8/ProGuard safety, the WorkManager constructor, FOSS exclusions and 16 KB page-size alignment. It cannot guarantee successful device startup; Google Play internal testing and TestFlight are the real-device validation environments
- See [Android Build / Release Notes](./integrations-and-operations.md#release-abi-and-16-kb-page-size)

### In-app update priority

Normal release (flexible, the default):

1. Bump `version`, `android.versionCode` and `ios.buildNumber`, update the Play changelog, commit and push to `main`.
2. Push the `v<version>` tag. `release.yml` publishes with priority `0`: the app downloads in the background and shows its own restart toast.

Emergency release (immediate):

1. Complete the normal release steps, then push the tag and cancel the automatic run before its `distribute-play` job if you need to publish with priority instead.
2. Run the `Release` workflow manually for that tag with `update_priority` `4` or `5`. Play then requires its full-screen update flow for users below that version.

Priority is per release, not per app: Google Play cannot change it after the release is rolled out, and a device may observe the highest priority across skipped versions and other tracks. A priority of `4`–`5` therefore affects devices that jump from any older version, even if an intermediate release was normal. Do not use `4`–`5` for routine releases. This is Google Play's in-app update priority, unrelated to notification priority or the version number.

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

**Release Automation** (`.github/workflows/release.yml`):
- A `v*` tag builds and signs the iOS archive automatically in parallel with Android
- The IPA is verified for signature, bundle identifier, version, build number, production push entitlement and provisioning-profile identity
- When App Store Connect API credentials are configured, the IPA is validated and uploaded to TestFlight automatically
- The signed IPA is attached to the GitHub Release. No manual iOS workflow dispatch is required
- App Store production submission and phased release remain separate manual store-console actions

### Testing

- `npm run test:ci:static` runs lint, app type-checking, the typed-test
  type-check (`npm run typecheck:tests`, via `tsconfig.tests.json`), and the
  Vitest suites (`tests/vitest/`)
- Flow validation runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`
- End-to-end suite uses Playwright (`tests/e2e/*.spec.mjs`, split by domain over `tests/e2e/helpers/flows.mjs`)
- `npm run test:e2e:smoke` runs the critical flows; `npm run test:e2e:web:isolated`
  allocates fresh ports for concurrent local runs; `npm run validate:fast` is an
  optional focused loop
- `ci.yml` runs the smoke set in one job with four workers; `release.yml` runs the
  full Playwright suite once on a version tag. Each worker has its own fake V1/V2
  pair, and the worker backend resets before every test
- Full testing strategy documented in `docs/engineering/testing-overview.md`; remaining deferred test work in `docs/engineering/known-gaps.md`

### Configuration

Connection settings are configured inside the app. By default, the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local configuration files (`.env`, `config.json`) are gitignored for security.

### Store update configuration

Android Play updates use flexible-first `expo-in-app-updates` and require a signed Play-installed
production app for runtime validation. FOSS excludes the package. iOS is disabled
until the verified public listing ID is supplied as `EXPO_IOS_APP_STORE_ID`;
`EXPO_IOS_APP_STORE_COUNTRY` is optional. See [app updates](../product/app-updates.md).
