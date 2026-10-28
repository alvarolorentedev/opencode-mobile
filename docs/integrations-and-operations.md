# Integrations And Operations

## External Runtime Dependencies

The app integrates with three main categories of external systems:

1. OpenCode server APIs
2. Expo / native device capabilities
3. local build, CI, and release tooling

## OpenCode Server Integration

### Connection Model

Server connectivity is based on:

- base server URL
- optional basic auth username/password
- optional project directory scoping per client instance

The base server URL may include a path prefix when OpenCode is exposed behind a reverse proxy, for example `https://host.example/api`.

Default server URL:

- `EXPO_PUBLIC_E2E_SERVER_URL`
- or `expoConfig.extra.e2eServerUrl`
- or fallback `http://127.0.0.1:4096`

### Authentication

If a password is present, the app sends:

- username defaulting to `opencode` if blank
- HTTP Basic auth header

Provider-specific auth is separate from server auth and is configured through OpenCode provider endpoints.

PTY WebSockets use a short-lived server-issued connect ticket in the query string. Their URL preserves any configured API path prefix, switches `http`/`https` to `ws`/`wss`, and includes the active project directory; Basic credentials are not embedded in the WebSocket URL.

### Failure Model

Current request failures are surfaced mainly as:

- connection error status and message
- snackbar errors in Chat
- dialog errors during provider configuration
- voice feedback errors

For connection failures caused by pointing at a web UI root instead of the OpenCode API base URL, the connection message should explicitly suggest using an API-prefixed URL such as `/api`. Web-UI responses (`text/html` or the SDK's "not supported by this version" error), 404s, and JSON parse failures all map to a message that names the address and the suggested API base.

The suggestion must never append `/api` to a URL that already ends in `/api`; when the configured URL is already an API base, the message instead reminds the user that the app supports OpenCode 1.x and 2.x servers and to verify the API base URL.

Before each connect attempt the app probes the server contract. A V2 server is spoken through the `@opencode/client` adapter; a V1 server keeps the existing SDK path. A 1.x `/global/health` version always wins over `/api` probes, since newer 1.x servers expose partial `/api` compatibility routes. If discovery under the detected contract fails with a contract-mismatch error, connect retries the other contract before surfacing an error.

The implementation favors user-facing recovery over deep error taxonomy.

## Expo / Native Integrations

### Expo Router

Used for app navigation and typed route structure.

### React Native Paper

Used for most UI components and themed surfaces.

### AsyncStorage

Used for persistence of user settings and lightweight workflow continuity state.

### Localization

`expo-localization` detects the device/app locale for the i18n runtime. `i18next` / `react-i18next` provide the runtime, English is bundled as the source and fallback language, and translations are organized by feature namespace under `lib/i18n/locales/`. `lib/i18n/resources.ts` is generated from those folders with `npm run gen:i18n` (`test:i18n` verifies it is current). Shipped locales: English (source), Spanish, Hindi, German, French, Simplified Chinese, Portuguese, Japanese, and Russian. The `supportedLocales` plugin option exposes the shipped languages to iOS and Android. The active in-app language is a normal persisted preference (stored with chat preferences); an unset preference follows the OS locale. See `docs/state-and-data.md` and `docs/architecture.md`.

### Notifications

`expo-notifications`, `expo-background-task`, and `expo-task-manager` are used together for:

- local task-complete notifications with finished/failed copy and a non-secret
  route payload that reopens the owning session
- Android notification channel configuration (silent `task-finished-silent` and
  default-importance `task-attention`)
- locally observed, deduped needs-input notifications when a tracked task blocks
  on a permission or question while the app is not foregrounded
- optional periodic background session-completion checks on supported native builds
- Android server-wide activity notifications through a local Expo module and
  `dataSync` foreground service; its Headless JS keepalive preserves provider
  SSE/polling while work is active, without FCM or an additional npm dependency

Important current rule:

- background monitoring is considered unsupported on web and unsupported in Expo Go (`Constants.appOwnership === 'expo'`)
- live activity stops at idle, dismissal, scope changes, service timeout, or
  process termination; periodic completion monitoring remains the fallback
- iOS background delivery is best effort only: a suspended app can only be woken
  opportunistically, so completion notifications arrive when the app next runs or
  the system schedules the background task, never on a fixed schedule

### Quick Actions

`expo-quick-actions` publishes dynamic launcher/home-screen quick actions on iOS
and Android: New chat plus up to three running/recent sessions. The package is
dynamic-only here — no config plugin, no static shortcuts — so nothing is added
to `Info.plist` or `shortcuts.xml`, and installation on existing devices only
gains items after the first app launch. `lib/quick-actions.ts` owns the bridge
and no-ops on web/Expo Go/E2E; publishing is debounced and foreground-only
because Android throttles dynamic shortcut updates in the background. Session
items carry only the non-secret `{ sessionId, projectPath, connectionScope }`
payload and route through `app/session/[id].tsx`.

### Android Home Widgets

`react-native-android-widget` (MIT, pure Android) provides three resizable 4×3
widgets: Latest replies (`SessionWidget`, retaining existing placements), Awaiting
actions (`AttentionWidget`) and current-chat Plan progress (`PlanWidget`). There
is no automatic update period. Provider-owned service reads and the existing SSE
plus polling runtime update bounded snapshots; notification permission is not
required. Headless add/resize/reboot handlers only read and render stored data.
Each surface keeps its last successful observation time on failures and displays
an absolute timestamp. Suspended/terminated apps leave dated snapshots.

Show widget previews defaults on in Android General Settings. Disabling it strips
reply/request excerpts and step content from storage and repaints all instances.
Titles/counts/status remain. Snapshot writes are ordered before repaint and reject
stale connection results. The existing two R8 WorkManager keep rules remain.
Gallery labels/descriptions are English because the plugin emits non-translatable
resources; widget contents support every shipped language. iOS remains
[deferred](ios-widget-parity.md).

### Voice Output

`expo-speech` is used for TTS.

Behavioral details:

- speech playback strips markdown-like formatting into more speakable text
- voice ducking is implemented through `expo-audio` audio mode changes
- silent mode playback is enabled on iOS
- background audio is intended to remain active

### Voice Input

`expo-speech-recognition` is used for speech-to-text.

Behavioral details:

- on-device recognition can be required by preference
- interim results are enabled
- continuous listening is used for conversation mode except where platform behavior differs
- user-friendly error messages are mapped from native error codes

### Working Sound

The app synthesizes its own short looping WAV file at runtime and plays it with `expo-audio`.

Why it matters:

- there is no bundled audio asset dependency for working sound
- parity requires preserving the generated-loop behavior or an equivalent sound loop experience
- the provider starts the loop while prompt submission or any session is busy when the preference is enabled
- the loop is stopped during conversation listening/speaking and when no work is active

### Device Wake

Conversation mode also uses:

- `expo-keep-awake`

The app never overrides screen brightness, so the system brightness setting
always applies.

### Document Picker

`expo-document-picker` is used for chat attachments.

Current behavior:

- multiple files supported
- files copied to cache directory
- duplicate attachment URIs filtered out client-side
- the selected model must advertise attachment support
- local files larger than 10 MB are rejected before base64 conversion

### Share Receive (Inbound)

Android accepts single/multiple generic files (`*/*`) using `expo-sharing`.
The prebuild config calls `scripts/prepare-android-sharing.cjs`, an idempotent,
version-checked patch for 57.0.22: text/plain streams and accompanying text are
preserved, copies use unique cache names, and unknown-size files are bounded
while reading. Upgrading Expo Sharing requires reviewing this patch. Native
resolution failures produce skipped items instead of fabricated readable files.
JS normalizes `file:/` to `file:///`, preserves encoding and applies the existing
URI allow-list, ten-item and 10 MB per-file limits.

The provider stages content in memory for ten minutes and owns receipt/destination
identity, confirmation and cancellation. Preview offers current chat, another
conversation on the active connection, or New chat. Add awaits provider session
resolution; the matching composer consumes once and retains existing draft
content. Errors keep the preview available. Nothing auto-submits. Web receives
no native payloads; the iOS Share Extension remains [deferred](ios-share-parity.md).

### Platform Settings Deep Links

The Settings screen uses:

- `expo-linking`
- `expo-intent-launcher`
- `expo-web-browser`

These support app settings, notification settings, battery settings, and provider or remote-MCP OAuth browser flows. Code-based OAuth flows show an authorization-code input and call the corresponding callback.

## OpenCode Compatibility

The client is implemented against the current `@opencode-ai/sdk` 1.18.3 contract and uses generated SDK types rather than permissive legacy endpoint shims. It is latest-only support: older server shapes and removed endpoint forms are not compatibility targets.

## App Configuration

`app.config.ts` controls build-time app configuration.

Notable values:

- app variant controlled by `EXPO_APP_VARIANT`
- E2E mode controlled by `EXPO_PUBLIC_E2E_MODE=1`
- Android package name varies between production and development variants
- Expo Router, notifications, background task, speech recognition, and splash plugins are configured
- `expo-localization` is configured with `supportedLocales` for iOS and Android
- React compiler and typed routes are enabled in Expo experiments

## Environment / Variant Rules

### Production vs Development App Variant

- production app name: `OpenCode Mobile`
- development app name: `OpenCode Mobile Dev`
- Android package changes accordingly

### E2E Mode

When E2E mode is enabled:

- the root layout skips notification initialization
- the root layout skips voice audio bootstrap

This reduces nondeterministic side effects during automated flow tests.

## Operational Scripts

Important npm scripts from `package.json`:

- `npm run start`
- `npm run start:dev-client`
- `npm run web`
- `npm run android`
- `npm run ios`
- `npm run lint`
- `npm run typecheck`
- `npm run test:fake-server`
- `npm run test:fake-server:self`
- `npm run test:e2e:web`
- `npm run build:development:android`
- `npm run build:android`

Additional repo scripts support Android build automation.

## Android Build / Release Notes

The build scripts generate a native `android/` project and use its Gradle build path.

This means Android delivery is not purely managed Expo. The current implementation expects:

- local Gradle-based Android builds
- GitHub Actions Android build workflows
- signing secrets for release builds

Release signing credentials (`ANDROID_KEYSTORE_*`) are injected through a
temporary `android/gradle.properties` for the duration of the Gradle
invocation rather than passed as `-P` arguments, so the passwords never appear
in the process list or in the command echoed by
`scripts/build-android-release.mjs` on failure. The generated file is restored
when the build exits. `keytool` reads the store password via `-storepass:env`,
keeping it off its command line too.

Production Android prebuilds use `expo-build-properties` to enable release
minification and resource shrinking. The plugin is omitted for the development
app variant; Android debug builds keep their normal unminified configuration.
The production config plugin also selects Android's optimized default R8 rules;
the React Native template's legacy `proguard-android.txt` disables code
optimization even when minification is enabled. The generated `android/`
directory is ignored, so `app.config.ts` remains the source of truth.

Play's R8 optimization check also wants optimized resource shrinking. AGP 8.12
(RN 0.86.3's pinned version) only enables it via the
`android.r8.optimizedResourceShrinking` Gradle property, which `app.config.ts`
sets alongside the JVM args. AGP 9+ enables it by default; forcing AGP 9 is not
compatible with this RN/Expo SDK and waits on the next SDK bump.

Two more Play findings are handled in `app.config.ts`:

- The app is orientation-unrestricted (`orientation: 'default'`) so Android 16
  stops ignoring the old portrait lock on large screens. The ML Kit
  barcode-scanner delegate activity that `expo-camera` pulls in is overridden to
  `unspecified` for the same reason (release/FOSS variants without `expo-camera`
  skip this).
- React Native's own `StatusBarModule`/`WindowUtilKt` still reference the
  Android 15-deprecated `setStatusBarColor`/`setNavigationBarColor` APIs, so the
  edge-to-edge warning cannot be fully cleared until RN removes them
  (upstream `facebook/react-native#48256`). The Material origins are fixed by
  pinning `com.google.android.material:material:1.14.0` over Expo's 1.13.0.

Production config adds custom keep rules for Expo's Pika record introspection
runtime and classes loaded reflectively, including `RNHeadlessAppLoader`. These
rules retain Expo record converters and add about 33 KB to the arm64 release
APK. No keep rules target the app's own namespace. The generated React Native
template includes its Reanimated rules; native dependencies also contribute
consumer rules for Expo task/notification modules, React Native, Worklets, and
Glide image loading.

### Release ABIs And Gradle Memory

Release artifacts are built for a trimmed set of ABIs via
`-PreactNativeArchitectures`, passed by `scripts/build-android-release.mjs` from
the `ANDROID_RELEASE_ABIS` environment variable (default `arm64-v8a`). CI builds
version `v*` tags with `armeabi-v7a,arm64-v8a` (Play-ready, 32-bit + 64-bit ARM)
and other builds with `arm64-v8a` only. x86/x86_64 are omitted because only
emulators need them, and emulators are served by
`npm run build:development:android`, which keeps all four ABIs. Building fewer
ABIs cuts per-ABI native compile and packaging work and lowers bundletool's peak
memory.

`app.config.ts` also raises the Gradle daemon JVM args (via `withGradleProperties`)
above the Expo template default of `-Xmx2048m -XX:MaxMetaspaceSize=512m`, which
was insufficient for `:app:packageReleaseBundle` and failed the release build
with `Java heap space`. The generated `android/` directory is ignored, so
`app.config.ts` remains the source of truth for both settings.

### Memory Profiling Targets

The chat loads the newest 200 raw records per session on open, reconciles with
the newest 20, and lazily pages older history in 200-record batches as the user
scrolls up. Loaded history is retained for the session so the first message stays
reachable. The persisted transcript cache remains tail-bounded. Provider caches
are pruned to the current/conversation sessions, non-idle sessions, and one spare
session; the active transcript still keeps its raw records and derived transcript
in memory. FlashList virtualizes rendered rows, but does not reduce those data
caches. The tab layout sets no unmount-on-blur policy, so include returning to
Chat after opening other tabs in device profiling.

Attachments are limited to 10 MB each, not in aggregate. Local files are read
and base64-encoded while a prompt is being prepared, and web picker data URLs
remain in composer state until send. Profile long transcripts, long streamed
replies, and several near-limit attachments on a low-memory Android device.
The terminal bounds pending output to 2 MiB and xterm scrollback to 10,000 lines
per opened PTY, disposing its sockets and timers on project changes or provider teardown;
the inspected paths show no clear listener/timer leak to fix without profiling
evidence.

The persisted session cache contains only small session DTOs and statuses, with
a seven-day TTL. Its keys are per connection + project, and saved connection
profiles add one small metadata entry each, so profile several saved servers
with large project catalogs if storage growth becomes visible.

## Security / Data Handling Notes

### Locally Stored Sensitive Data

The app splits persisted connection data:

- server URL and username (and saved connection profile metadata such as the profile name and model selection) live in AsyncStorage
- the active connection password and each saved profile password live in Keychain/Keystore-backed SecureStore via `lib/connection-password.ts` and `lib/connection-profiles.ts`, never in AsyncStorage
- legacy plaintext `settings.password` is migrated to SecureStore and stripped during hydration
- `opencode-mobile.widget-snapshot` stores bounded routing data, counts/status, timestamps and enabled reply/request/plan excerpts. Authentication credentials, raw request metadata and tool output are excluded; disable Show widget previews to remove excerpts.

Operational implication:

- server-derived persisted state (session caches, remembered sessions, favorites, pending notifications) is scoped by the password-free connection scope from `lib/connection-scope.ts`, so credentials never appear in those keys or DTOs
- a rewrite must keep the credential split when adding new persisted fields

### Notification Tracking Storage

Pending notification sessions store only a non-secret connection reference —
`serverUrl`, `username`, and `connectionScope` — in AsyncStorage so background
checks can authenticate. Records are keyed by connection scope + session ID, and
the background monitor resolves the password for the record's own connection
(saved profile first, then the active connection if it matches). A pending
record is never deleted just because another connection is active.

### Local Config Files

Repo documentation already notes that `.env` and `config.json` are intentionally gitignored because they may contain secrets.

## Platform Support Notes

### Web

Current limitations / differences:

- notifications are effectively unsupported
- background monitoring is unsupported
- root bootstrap skips native notification/voice initialization paths

### Android

Android has the richest current support for:

- notifications
- notification settings deep links
- battery optimization guidance
- development and release build pipelines
- launcher quick actions and the three Android home widgets

### iOS

iOS is supported by Expo/React Native setup, but some operational tooling in the repo is Android-focused. Voice and TTS behavior are still explicitly supported. Launcher quick actions are supported; home/Lock Screen widgets and Live Activities are deferred (see [iOS widget parity](ios-widget-parity.md)).

### Session Deep Links

Session deep links (`opencodemobile://session/<id>?project=...`, web path `/session/<id>`) resolve through the configured custom scheme and Expo Router web paths. Universal/app links (HTTPS share URLs launching the app) and Android intent filters for the deep-link host are not configured; links are consumed only when the app scheme or web path is used directly.

## Operational Risks And Important Assumptions

### 1. Provider-Orchestrator Concentration

The provider is a single behavioral hub. Operational regressions often come from touching one file with many responsibilities.

### 2. Event Stream Reliability Is Not Assumed

The app is intentionally written to keep functioning if SSE disconnects or cannot connect.

### 3. Mobile File Attachments Must Be Marshaled

A reimplementation cannot send `file://` URIs directly to the server and expect parity.

### 4. Background Conversation Is Not Full Duplex Background Audio Capture

The app includes device and voice support, but continuous background microphone capture is not described as supported behavior.

### 5. Some UI Settings Modify Prompting, Not Local Logic

On OpenCode 1, `reasoning`, `responseScope`, and `includeNextActions` are implemented by generating system prompt instructions rather than by changing UI logic. On OpenCode 2, the Reasoning selector chooses one of the selected model's server-reported variants and sends it through the session model switch; `responseScope` and `includeNextActions` remain prompt instructions.

That distinction is important when validating parity.
