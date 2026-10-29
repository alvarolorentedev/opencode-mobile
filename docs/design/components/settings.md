# Settings Components

Settings sections, connection and Cloud Link surfaces, provider configuration, and extension management. Back to the [component inventory](../component-inventory.md).

## Settings Components

`connection-method-chooser.tsx` renders the shared Scan QR code (local network),
Manual, and Cloud Link choices in that order, plus a learn-more link.
`connection-setup-form.tsx` composes the chooser with two independent flows for
onboarding and returning from pairing: the scan choice opens the camera-only
`connection-scan-flow`, and Manual opens the manual profile form.
`connect-onboarding.tsx` presents the four-step Cloud Link assistant (learn,
computer setup, subscribe, pair), with shared illustration/heading/subheading
spacing and pinned primary actions. Pair reuses the computer drawing beneath a
thin transparent, theme-tinted corner frame outside the display. It owns only
clipboard feedback; step and
scanner visibility are local presentation state in `connect-pairing.tsx`.
`connect-camera-gate.tsx` requests permission only after Scan QR code (including
the Connection section's local Scan QR code choice); denial returns to the
illustrated Pair step.
`connect-pairing.tsx` retains the existing scanner, appbar options, link fallback
and recovery overlays. Deep links bypass the assistant and camera gate. Returning
subscribers start on Pair; native subscription verification and pairing remain in
the provider. `connect-scanner.tsx` owns camera presentation/lifecycle and only
previews after permission is granted.
`connect-subscription.tsx` reuses native offers and explicit purchase/Restore.
Its assistant layout has a static single-offer summary (selection for multiple
offers), native pricing at body size, inline recovery, and a Restore text link
above Subscribe & continue. Other Settings/management callers retain their
existing compact layout.
`components/settings/sections/cloud-link-section.tsx` renders the consolidated Cloud Link surface in
this order: the access summary, the connector's exposed services (when a Cloud
Link connection is active), Subscription actions (native store management,
offers when inactive, one Restore row), and a Machines shortcut to the existing
management route, closing with a learn-more row. It uses the shared Settings
overlay and provider state; it
never opens the camera or starts a purchase merely by opening the section.
`connect-panel.tsx` renders the separate machine/profile management view. `app/pair.tsx` ingests links and navigates only; deep links skip the camera gate.
Domain state/actions come from `useConnection().connectSetup`; see [Cloud Link](../../product/cloud-link.md).

After a valid Cloud Link claim, the pairing surface shows desktop-confirmation
progress and hides recovery controls while the provider checks activation. A
delayed activation uses neutral text with Retry and Scan the new QR code on your
computer; the scan action resets the provider checkpoint and resumes the existing
scanner. It preserves stored profiles. Components do not poll or classify errors.

### `components/settings/sections/`

#### Section components

- `EditorSection`
- `GeneralSection`
- `UpdateSection`
- `ConnectionSection`
- `CloudLinkSection`
- `ServicesSection`
- `AiDefaultsSection`
- `NotificationsSection`
- `VoiceSection`
- `VoiceInputSetup` / `VoiceFlowScreen` / `VoiceMoreSettings`
- `LocalTtsSection`
- `ResponsesSection`
- `LanguageSection`
- `DiagnosticsSection`
- `SupportSection`

#### `ConnectionSection`

Responsibility:

- show connection state card
- show the current connection message or error hint from provider state
- render the saved-connection list (`ConnectionProfiles`)
- offer Scan QR code (local), Manual and Cloud Link creation choices through
  `Add connection`

The server URL/username/password fields are no longer a standalone form; they
live inside the connection rows (current connection row) or the add/edit
dialog, so there is a single place to configure a connection.

### `components/settings/connection-profiles.tsx`

#### Responsibility

- list saved connections as collapsible rows with name, host, and an Active/Connecting badge
- expand a row to see its server URL and username and to reach Connect, Edit, and Delete
- always render a `Current connection` row when the active connection has not been saved as a profile, so the live connection stays editable
- switch to a saved connection through `switchConnection()` (which persists the outgoing profile's model selection, restores the target's, and reconnects)
- add a connection through `Add connection` (saves metadata to AsyncStorage, password to SecureStore, and connects)
- edit a connection through the same dialog; editing the active connection applies to the live settings but waits for Reconnect, so an in-flight session is never dropped
- delete a saved connection and its SecureStore password/header secrets, except the active one
- mark the active Cloud Link row by trusted environment and machine ID, so rotating usernames do not create a temporary `Current connection` row; manual connections still compare `getConnectionScope()`

The component owns only local state (expanded row, dialog, switching row); profile state, persistence orchestration, and credential ordering live in `providers/use-connection-profiles.ts`, backed by `lib/connection-profiles.ts`; switching/reconnecting stay in the provider. The profile hook refreshes after the Cloud Link profile snapshot changes, including inactive-machine renewal while Settings remains mounted. The UI accesses these through `useConnection().connectionProfiles`.

### `components/settings/connection-profile-dialog.tsx`

#### Responsibility

- collect the server address first, then password and an optional name whose
  placeholder is the hostname; Continue displays an abortable detection state
- offer a collapsible Custom headers section with key/value rows for manual
  connections (Cloudflare Access service tokens and other gateways). Values are
  masked by default, validated before probing/saving, and passed to the provider
  as a normalized map; the section is never shown for Cloud Link profiles
- hide Username for confirmed V2, show it for V1, and offer a collapsed custom
  username when credentials are needed to identify the server
- The shared TextInput clears Paper's implicit text alignment for single-line
  iOS fields to prevent wrapping. Explicit caller alignment takes precedence;
  password masking and credential values remain native and unchanged.
- validate the URL, surface probe/pair/save errors inline, and disable duplicate
  operations while busy; names default in the provider's save action
- own its form state for the lifetime of one dialog instance (mounted only while open)

Submit is a callback: the list component decides whether the values are added
as a profile plus connected, or applied to the existing profile/current
connection.
Changing the address or going Back preserves fields and invalidates obsolete
probes.
Editing uses the same form but saves without automatically reconnecting.

### `components/settings/connection-scan-flow.tsx`

#### Responsibility

- own the native-only local QR setup flow, separate from the manual address form;
  opened by the Scan QR code choice in Settings and onboarding
- reuse `ConnectCameraGate` and `ConnectScanner` full-bleed without a Cloud Link
  entitlement; claiming the code stays in the provider's
  `connectionProfiles.pair`
- overlay the `opencode pair` instructions, scan progress and recovery messages
  on top of the full-screen camera rather than boxing it into a step layout like
  the Cloud Link scanner
- save and connect through the caller's submit callback with the redeemed
  credential, retaining it across a failed save/connect so Retry never re-pairs
- return to the chooser on Back or camera denial, and offer Scan again after an
  invalid/expired/unreachable code

The manual address/details surface stays in `connection-profile-dialog.tsx`; the
scan flow never renders it.

### `components/settings/service-editor.tsx`

#### Responsibility

- render the full-screen add/edit form for one connector service: id (create
  only), optional name, path, target, access, enabled and strip-prefix
- mirror the connector's validation through `prepareServiceDraft`, showing
  per-field errors before spending a round trip
- offer the management revision 2 port picker (occupied and shared labels,
  disabled for the mode being edited) and the legacy path-only form with an
  update hint for older connectors
- own only local form state; every read/write goes through the provider's
  `services` domain, and Save returns through the caller's `onDone`

### `app/service.tsx`

Thin full-screen route for the service editor, registered beside `app/pair.tsx`
under the Cloud Link guard. It resolves the edited service from the provider's
services list, renders the shared `ServiceEditor`, and returns with
`router.back()`; a missing id shows a recoverable message instead of an empty
create form. No fetch or protocol logic lives here.

#### `AiDefaultsSection`

Responsibility:

- show configured providers
- tap a configured provider chip to reopen login or replace its API key
- allow adding unconfigured providers
- allow removing configured provider credentials
- on OpenCode 2, list a provider's labeled accounts, mark the active account, switch accounts, remove an account, or add another account
- show models grouped by provider
- allow toggling enabled model IDs

#### `AutoModelSection`

Responsibility:

- enable/disable prompt routing only after a classifier is usable
- switch between the pinned on-device GGUF pack and the OpenCode classifier
- download, verify, remove, and report the on-device pack
- probe the V2 classifier endpoint and select its model
- map Simple / Standard / Complex to Automatic or explicit visible models
- expose the long-chat prompt-cache guard
- the same panel is reused by onboarding AI & providers

#### `NotificationsSection`

Responsibility:

- show notification readiness
- request notification permission
- deep-link into app, notification, and battery settings

#### `VoiceSection`

- Two independent input/playback mode selectors, placed before their dependent controls.
- Confirm voice commands and Require wake phrase are shared by System and local
  input; no-wake mode shows the system-recognition privacy warning.
- System input shows speech language; local input shows one setup/manage row.
- System playback shows only OS voices; native local playback shows one pack dropdown,
  installed size, optional speaker picker and Manage downloads. Missing selections
  expose setup without activating an engine or starting a download.
- Preview and Read replies aloud remain visible; rate, progress readback, working
  sound, wake phrase (when required) and troubleshooting live in `VoiceMoreSettings`.
- Shared by Settings and first-run onboarding; tab blur stops preview and capture.

#### `VoiceInputSetup` and `VoiceFlowScreen`

- A focused full-screen flow with one Back/title/Close header and a pinned footer.
- Four illustrated steps: understand, prepare, optional voice profile, isolated wake test.
- Prepare uses language/model dropdowns, the size of missing files and explicit
  microphone/download actions; advanced options retain pack removal and wake phrase.
- Reuses existing models/profiles. Skipping a new profile explicitly disables
  speaker verification; an existing profile and preference are preserved.
- Done activates local input only after models and microphone permission are ready.
  Close leaves the active mode unchanged and preserves downloads/saved profiles.
- Presentation/step state is local. Native side effects use the setup hooks; the
  test reads the app-wide provider's `useVoiceTest()` interface.
- `LocalVoiceState` is the setup hook's inferred state type, not another state owner.

#### `LocalTtsSection`

- Focused download manager with one pack dropdown and actions for that pack.
- Shows size, status, download/retry, explicit Use, Preview and Remove.
- Retains language mismatch, Japanese system-voice guidance and total storage.
- Uses `useTtsSetup`; installing does not automatically select or activate a pack.

#### `EditorSection`

Responsibility:

- choose timeline detail (`Messages only`, `Reasoning`, `Everything`) with a
  three-step slider and the selected level's description
- adjust chat text size and the flat-conversation preference
- optionally edit prompt delivery when the active server supports it
- pass changes through `updateChatPreferences`; the feed filter is applied when
  `useChatViewController` derives transcript rows, not in this section

#### `ResponsesSection`

Responsibility:

- edit response scope and next-action hints separately from voice input/output
- pass changes through `updateChatPreferences`; no prompt construction or provider state lives here

#### `LanguageSection`

Responsibility:

- choose the app interface language or follow the system default
- persist the choice through `updateChatPreferences({ language })`; `undefined` follows the OS locale
- list the supported languages built from `SUPPORTED_LANGUAGES`

#### `AppearanceSection`

`components/settings/sections/appearance-section.tsx`, rendered inside
the Appearance category above the slim-interface switch.

Responsibility:

- choose the app theme mode (`follow system`, `light`, `dark`)
- choose a color theme (`green` default plus blue, red, purple, pink, gray)
  from accessible preview tiles that show the themed background, surface,
  border, and accent
- persist both through `updateChatPreferences`; `hooks/use-palette.ts` and
  `hooks/use-color-scheme.ts` consume the provider-published appearance context
- expose `settings-theme-mode` and `settings-accent-<name>` test IDs

#### `UpdateSection`

Responsibility:

- About & support → Update checks group for the app update feature
- toggle update checks and pick the check period (When available, Daily, Weekly)
- read and mutate the provider-owned update preference through `useUpdates()`
- render nothing when the update module is unavailable (`supported` is false)

#### `DiagnosticsSection`

Responsibility:

- show OpenCode health/version when available
- show global event stream state and whether polling fallback is active
- show MCP counts
- refresh diagnostics when the section opens and on demand; chat bootstrap no longer pays for diagnostics reads

#### `PermissionsSection`

Responsibility:

- V2-only Settings view of server-persisted "always allow" rules
- show each rule's resource and action, confirm-remove one, refresh on demand
- reads and mutates provider-owned `savedPermissions` through the chat
  `approvals` value; performs no fetch itself

#### `SupportSection`

Responsibility:

- open the native App Store/Play review flow through `expo-store-review` when `canRateApp()` allows it (iOS, or Android outside the foss variant)
- fall back to the Play Store listing only when Android reports that no native review action is available
- open the GitHub issue tracker for improvement feedback
- open the `https://getopencode.app/support/` page in the browser
- hold only URL constants, availability checks, and opening in `lib/support.ts`; no provider state

### `components/settings/provider-config-dialog.tsx`

#### Responsibility

- render the full-screen provider setup flow as two steps: pick a login method, then configure it
- select the method from a dropdown; selecting dismisses the dropdown and advances to the configure step
- render type-specific controls from the normalized prompt model (text/select/number/integer/boolean/multiselect/external) with `when` conditions
- run the OAuth states on the configure step (idle, waiting for automatic completion, pairing/authorization code) without nested overlay dialogs
- hand code/automatic OAuth completion back to Settings for submission

#### Prop contract

Main relevant props:

- `authValues`
- `methods`
- `oauthStage`, `oauthInstructions`, `oauthCode`
- `onAuthValueChange`
- `onBack`, `onSelectMethod`
- `onSubmit`, `onCompleteOAuth`, `onCancelOAuth`
- `selectedMethod`
- `selectedMethodIndex`
- `step`
- `visiblePrompts`

### `components/settings/mcp-section.tsx`

#### Responsibility

- add local command or remote URL MCP configurations
- reuse `use-mcp-authentication.tsx` and `ProviderConfigDialog` for native integration forms, code or automatic OAuth, cancellation and stale-result guards
- show v2 OAuth only for servers that expose an `integrationID`
- show status and failure details
- connect/disconnect, enable/disable, remove, refresh, and complete remote OAuth
- refresh MCP status when the section opens instead of during every connection bootstrap
- retain only form, busy, error, and OAuth-code UI state locally

### `components/settings/extensions-section.tsx`

#### Responsibility

- render the V2-only Extensions surface with General/Project scope, MCP/plugin/skill/command tabs, shared/read-only rows, and inline add/edit forms
- hide system-managed shared rows (built-in plugins, embedded skills, built-in commands) from the plugin, skill, and command tabs
- show the exact target config path, safety state, and last-backup recovery action
- delegate every mutation and refresh to `useExtensions()`; never fetch or persist config itself
- keep only form drafts, selected scope/tab, editing state, and local action feedback
- reuse the MCP authentication dialog and keep MCP runtime lifecycle actions in the existing MCP domain
- expose test IDs for the add/remove/edit controls used by the extension flows

### `components/settings/sections/services-section.tsx`

#### Responsibility

- list the connector's exposed services from `useConnection().services`, with name, full `https://<host>:<port><path>/` URL, address (`:2053` or `:8443/app`) → target, access and enabled state
- add/replace a service through an inline form (id fixed when editing), choosing a port from the connector's `service_ports`, and remove with confirmation
- keep the path optional on management revision 2 (empty serves the port root, with the keep-prefix toggle shown only for path services) and stay on the legacy path-only form, plus a non-blocking update hint, for revision 1 or unknown older connectors
- mirror the connector's validation locally and surface the connector's own error message on rejection
- copy the service's shareable `https://<host>:<port>/` or `https://<host>:<port><path>/` link
- own only form, busy, error and feedback UI state; all reads/writes and canonical values come from the provider's services domain
- rendered only for Cloud Link connections; the provider hides it for manual connections

### `components/settings/settings-utils.ts`

#### Responsibility

- response scope option definitions
- working sound option definitions
- provider marketing copy
- provider marketing copy and settings option lists
