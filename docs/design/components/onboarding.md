# Onboarding Components

Onboarding steps, shared settings, and provider setup presentation. Back to the [component inventory](../component-inventory.md).

## Onboarding Components

### `app/onboarding/*.tsx`

Responsibility:

- eight connected steps: app presentation, permissions, add connection, AI & Providers, project, General Settings, Voice & Responses, ready; disconnected navigation skips AI and project
- presentation only describes the app, with Continue navigation; AI and General are optional and reuse Settings controls
- permissions, connect, AI, project, General and Voice & Responses are skippable; Skip advances without additional writes or undoing earlier choices
- General edits language, the remembered Chat model (connected only), and Steer/Append delivery (connected V2 only)
- ready summarizes connection/project plus the applicable providers, enabled models and preferences, then completes first-run setup or closes review mode
- thin controllers only; connection/project persistence and permission requests are delegated to the provider and existing helpers
- seeded from current provider state so re-running from Settings reviews rather than resets
- the project step reads the provider catalog and offers Retry only when it is empty; there is no permanent refresh action in the footer

### `components/onboarding/onboarding-step.tsx`

- shared translated step chrome: back action, step progress, title/subtitle, scrollable body, pinned footer
- `navigation.ts` defines the visible sequence; `use-onboarding-navigation.ts` derives progress and forward/back destinations from connection availability
- inaccessible server steps redirect to General; reconnects preserve provider setup, and Android Back uses the visible sequence
- Review setup appears beside the step indicator when reopened from Settings
- keeps every step visually consistent without duplicating layout

## Shared onboarding settings

- `components/settings/ai-settings-panel.tsx` composes the existing AI section, auth dialog, model/account callbacks, removal confirmation and feedback for Settings and onboarding
- `general-settings.tsx` reuses language and chat preference fields, with a searchable model select using the same `getVisibleModels` filter as Chat and Review
- `voice-settings.tsx` reuses `VoiceSection` in its onboarding view and `ResponsesSection`, with the existing voice/TTS setup hooks; on-device model downloads, enrollment and preview are explicit actions. The route unmounts the panel on blur to release audio.
- `components/settings/use-speech-voices.ts` shares read-only OS voice enumeration between Settings, onboarding and Ready.
- `setup-summary.tsx` includes input mode/model, playback engine/voice, automatic readback and response style, and renders current provider values with wrapping rows and omits connection-dependent additions offline

### `components/onboarding/project-options.tsx`

- presentational project-row list shared by `ProjectPicker` and the onboarding project step
- renders an optional close control that removes a project locally; callers own empty/loading states and whether closing is offered

### `providers/onboarding-state.ts`

- `CURRENT_ONBOARDING_VERSION`, parse/serialize for the completion marker
- pure `resolveOnboardingStatus()` migration decision and the storage-backed `loadOnboardingStatus()`
- completion only; never stores connection, project, preference, or permission values

### `components/settings/use-notification-setup.ts`

- notification permission/status/platform-settings controller shared by Settings and onboarding
- requests permission only from `enable()`; `refreshStatus()` is read-only

### `components/settings/use-provider-configuration.tsx`

- provider credential dialog state machine (manual API key and OAuth, including the code callback) used by Settings
- returns the dialogs as `dialog` plus `feedback`/`setFeedback`

### `lib/voice/permissions.ts`

- `getVoiceInputPermissionAsync()` (read-only) and `requestVoiceInputPermissionAsync()` (explicit-action only) wrappers over `expo-speech-recognition`
