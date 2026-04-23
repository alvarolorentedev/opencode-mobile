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

Default server URL:

- `EXPO_PUBLIC_E2E_SERVER_URL`
- or `expoConfig.extra.e2eServerUrl`
- or fallback `http://127.0.0.1:4096`

### Authentication

If a password is present, the app sends:

- username defaulting to `opencode` if blank
- HTTP Basic auth header

Provider-specific auth is separate from server auth and is configured through OpenCode provider endpoints.

### Failure Model

Current request failures are surfaced mainly as:

- connection error status and message
- snackbar errors in Chat
- dialog errors during provider configuration
- voice feedback errors

The implementation favors user-facing recovery over deep error taxonomy.

## Expo / Native Integrations

### Expo Router

Used for app navigation and typed route structure.

### React Native Paper

Used for most UI components and themed surfaces.

### AsyncStorage

Used for persistence of user settings and lightweight workflow continuity state.

### Notifications

`expo-notifications`, `expo-background-task`, and `expo-task-manager` are used together for:

- local task-complete notifications
- Android notification channel configuration
- optional periodic background session-completion checks on supported native builds

Important current rule:

- background monitoring is considered unsupported on web and unsupported in Expo Go (`Constants.appOwnership === 'expo'`)

### Voice Output

`expo-speech` is used for TTS.

Behavioral details:

- speech playback strips markdown-like formatting into more speakable text
- voice ducking is implemented through `expo-av` audio mode changes
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

The app synthesizes its own short looping WAV file at runtime and plays it with `expo-av`.

Why it matters:

- there is no bundled audio asset dependency for working sound
- parity requires preserving the generated-loop behavior or an equivalent sound loop experience

### Device Wake / Brightness

Conversation mode also uses:

- `expo-keep-awake`
- `expo-brightness`

Brightness behavior is best-effort and permission-dependent.

### Document Picker

`expo-document-picker` is used for chat attachments.

Current behavior:

- multiple files supported
- files copied to cache directory
- duplicate attachment URIs filtered out client-side

### Platform Settings Deep Links

The Settings screen uses:

- `expo-linking`
- `expo-intent-launcher`
- `expo-web-browser`

These support app settings, notification settings, battery settings, and provider OAuth browser flows.

## App Configuration

`app.config.ts` controls build-time app configuration.

Notable values:

- app variant controlled by `EXPO_APP_VARIANT`
- E2E mode controlled by `EXPO_PUBLIC_E2E_MODE=1`
- Android package name varies between production and development variants
- Expo Router, notifications, background task, speech recognition, and splash plugins are configured
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
- `npm run build:release:android`

Additional repo scripts support:

- Cloudflare Expo startup helpers
- Android build automation
- icon generation
- secret export helpers

## Android Build / Release Notes

The repository includes a native `android/` project and Gradle build path.

This means Android delivery is not purely managed Expo. The current implementation expects:

- local Gradle-based Android builds
- GitHub Actions Android build workflows
- signing secrets for release builds

## Security / Data Handling Notes

### Locally Stored Sensitive Data

The app persists server URL, username, and password in AsyncStorage.

Operational implication:

- this is convenient but not equivalent to using a secure credential store
- any rewrite should treat credential persistence as a deliberate product/security decision, not an accidental implementation detail

### Notification Tracking Storage

Pending notification sessions also store a subset of connection settings in AsyncStorage so background checks can authenticate.

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

### iOS

iOS is supported by Expo/React Native setup, but some operational tooling in the repo is Android-focused. Voice and TTS behavior are still explicitly supported.

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

`reasoning`, `responseScope`, and `includeNextActions` are implemented by generating system prompt instructions rather than by changing UI logic.

That distinction is important when validating parity.
