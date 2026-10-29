# Design system

This is the implementation reference for new features. Settings and its shared
onboarding controls are the first complete application of these rules. Existing
Chat, Projects, Terminal and Cloud Link patterns remain valid; adopt the shared
foundations when touching their presentation, without unrelated restyling.

## Sources of truth

| Concern | Source |
| --- | --- |
| Semantic colors and platform font families | `constants/theme.ts` |
| Theme modes and six color presets | `constants/appearance.ts` |
| Paper mapping | `constants/paper-theme.ts` |
| Spacing, shape and minimum sizes | `constants/design-tokens.ts` |
| Effective appearance | `usePalette()` and `useColorScheme()` |
| Settings navigation and availability | `buildSettingsSections()` |
| Searchable controls | `settingsTargets()` |

Use the existing provider-centric architecture. Components render state and
forward actions; they do not fetch, persist preferences, normalize protocol
payloads, or create shared domain stores. Presentation state such as a search
query, open sheet or expanded group stays local.

## Foundations

### Color and contrast

Use semantic palette roles rather than literal colors:

- `background`: page canvas and inset fields; `surface`: sheets and grouped rows.
- `surfaceAlt`: secondary surfaces, pressed/selected states and search highlights.
- `text`: primary content; `muted`: supporting copy; `border`: boundaries.
- `tint`: interactive emphasis and focus; `accent`: secondary emphasis.
- `success`, `warning`, `danger`: semantic status, independent of the preset.
- `bubbleUser`, `onBubbleUser`, `bubbleAssistant`, `onBubbleAssistant`, `code`:
  conversation-specific roles; do not repurpose them for settings.

Support system/light/dark and green/blue/red/purple/pink/gray. Resolve colors
through `usePalette()`, not direct `Colors.light` reads. Use `getPaperTheme()` for
Paper components. Status always has text or an icon as well as color. Target
4.5:1 text contrast and 3:1 essential control/focus contrast; verify the actual
foreground/background pair, including muted text and every selectable preset.
Do not communicate disabled state through opacity alone: expose disabled
semantics and explain an unmet prerequisite near the control.

### Typography

Keep platform fonts; do not add a font dependency. App-shell titles use
`Fonts.display` with weight 700. Body controls use Paper's platform typography;
code, commands and paths may use `Fonts.mono`.

| Role | Paper variant | Default size/line height |
| --- | --- | --- |
| Sheet title and category row | `titleMedium` | 16/24 |
| Section heading | `titleSmall` | 14/20 |
| Field value and switch title | `bodyLarge` | 16/24 |
| Description, status, breadcrumb | `bodyMedium` | 14/20 |
| Field label | `labelMedium` | 12/16 |

Use sentence case, concrete labels and short supporting descriptions. Distinguish
app interface language from speech language. Prefer “Review setup” to “Reset
onboarding”: the action reviews existing preferences rather than erasing them.
Let labels, values and descriptions wrap and rows grow. Do not shrink type or
truncate critical instructions to fit. Preserve OS text scaling; fixed app-shell
chrome retains its documented scaling limits.

### Layout, shape and targets

`Spacing` supplies 4, 8, 12, 16, 24 and 32 points. Use 16-point screen gutters,
24 between groups, 12 between related controls, and 4 between label and value.
Constrain wide settings content to 800 points and center it.

`Shape` supplies 14-point controls, 18-point groups and 24-point sheets. Prefer
borders and theme surfaces to additional shadows, gradients or nested cards.
`ControlSize` supplies 48-point minimum interactive targets, 56-point fields and
76-point navigation/switch rows. These are minimums, not fixed heights. Compact
mode must not reduce the accessible hit area. Small decorative icon tiles may
be smaller because the entire row is interactive.

Use MaterialCommunityIcons from the installed icon library. A trailing chevron
means navigation or disclosure; a switch changes a boolean immediately. Icons
beside a complete label are decorative. Never substitute letter glyphs for icons.

## Components and interaction patterns

| Need | Reuse | Behavior |
| --- | --- | --- |
| Navigate to a settings category | `SettingsHome` registry row | Icon, title, current summary, chevron; entire row opens its sheet |
| Boolean preference | `SettingSwitchRow` | One accessible switch target; label press and switch graphic share one action |
| Choose one value | `SettingSelectField` / `NativeSelect` | Label and wrapping value; `compact` puts label/value on one row; searchable choices for long catalogs |
| Primary/secondary action | `SettingButton` | Existing Paper modes with a 48-point target and shared control radius |
| Edit a settings form | `SettingTextInput` | Shared outline/radius; retain validation, secure entry and keyboard options |
| Adjust a numeric preference | `SettingSlider` / `NumericSlider` | Label, readable value, existing range, adjustable semantics and web arrow keys |
| Advanced settings | `SettingsDisclosure` | Labeled button with expanded state; search and attention states reveal its content |
| Category content | `OverlaySheet` + `SettingsPanel` | Stable title/Close header, keyboard-safe scrolling, safe-area padding, Android Back and header-drag dismissal |
| Locate a searched setting | `SettingTarget` | Reveal, scroll, highlight and announce the matching label without changing its value |
| Short confirmation or choice | Existing dialog / `NativeSelect` | Keep existing modal, auth and confirmation contracts |

Use one contained primary action per form/group. Use outlined secondary actions
and text tertiary actions. A destructive action names its object and preserves
its existing confirmation and recovery behavior. Immediate preferences do not
need a Save button; connection/auth/editor forms keep explicit save actions.
Downloads, microphone requests, enrollment, purchase/Restore and external links
always require an intentional user action. Opening a sheet or a search result
must never trigger one of these actions.

### State and feedback

- **Loading:** show “Checking…” or a spinner until known; do not report unknown
  permission status as Off. Disable duplicate submissions while pending.
- **Empty:** explain what is missing and offer the relevant existing setup action.
- **Disabled:** preserve its label/value, accessible state and prerequisite hint.
- **Error:** keep the actionable error and retry/setup action close to its cause.
  A disclosure with an error or active required setup stays expanded.
- **Success:** update the current value/status immediately; use existing snackbars
  for completed requests. A preference switch does not need a success toast.
- **Destructive:** use `danger` with a clear action label; retain confirmation.

Animate through existing sheet primitives only. Do not add decorative motion.
Respect platform reduced-motion behavior and do not require gestures: Close and
Back remain alternatives to dragging.

## Settings organization and search

Home order is App preferences, Connections, Selected server. App preferences
contains Appearance, Chat & responses, Voice & audio, Notifications, Language,
and About & support. Connection management and Cloud Link have their own group.
AI & providers, Extensions, Approvals and Server diagnostics use the independent
inspection target. Show server selection only when multiple servers exist;
preserve project selection where applicable. Inspecting settings must not move
the active chat or alter preference scope.

Each category is declared once in `buildSettingsSections()`: stable `id`,
`group`, icon, localized title/summary, open action and renderer. Its `targets`
come from `settingsTargets()` with the same platform/capability conditions as its
controls. Search uses localized catalog copy and keywords only, never current
values, server content or secrets. It is local and is not persisted.

To add a searchable control:

1. Reuse a shared settings row/field/slider, which already provides a target.
   For custom content, wrap it in `SettingTarget` with its localized label.
2. Add the same label and any existing explanatory copy to `settingsTargets()`.
   Gate it exactly as the rendered control is gated.
3. For collapsed content, set the target's `group` to the disclosure's stable
   `id`. For extension tabs, use the existing `extensions-<tab>` destination.
4. Test that selecting the result reveals the control without submitting,
   downloading, requesting permissions or changing a preference.

Search matches all query words without case/diacritic distinctions. Results name
the setting and its category; a category-only match opens the category. Closing
a result retains the query. Clear search restores the grouped list. Unsupported
controls are omitted; setup-dependent controls retain their disabled explanation.

## Accessibility, localization and feature acceptance

Use explicit accessible labels, checked/expanded/disabled states, logical focus
order and visible keyboard focus. Avoid exposing both a row and its decorative
switch as separate controls. Announce search destinations without activating
them. Never claim screen-reader compliance from screenshots alone.

Keep strings in all nine supported locales and run `npm run gen:i18n` after
catalog changes. A feature is not complete until every new or changed
user-facing string is translated in every supported locale, with matching
interpolation placeholders and plural categories; English fallback copy in a
shipped locale is an incomplete feature, not an acceptable default. Do not build
sentences by concatenating translated fragments.
Check long translations, 200% text scaling, 320-point width, 390-point phones,
landscape, tablets, keyboard-open forms, safe areas and nested dialogs. Verify
light/dark and all accent themes; use existing palette contrast tests as a floor.

Before shipping a feature, verify correct state ownership, shared components,
complete searchable destinations, current/empty/loading/error states, disabled
prerequisites, keyboard/Back/Close behavior, persistence/scope continuity,
translations and regression coverage. Update implementation docs when behavior
changes. E2E or fake-server changes require explicit human validation under
`AGENTS.md`, even after the automated gates pass.

## Conditional controls and guided device setup

Place an engine/method selector immediately after its section heading, followed
only by controls belonging to the selected method. Voice input and Spoken replies
are independent sections; avoid repeating their headings inside status cards or
disclosures. Keep daily actions visible and move occasional controls into one
More audio settings disclosure.

Model catalogs use a compact select row, never a stack of model cards. Keep the
selected model's status/size beside Manage downloads; open a focused manager for
download/removal. Selecting an unprepared engine may expose setup but must not
download, request permission or silently activate it.

Use `VoiceFlowScreen` for the focused voice flow: one Back/title/Close header,
scrollable content, centered width constraint and pinned primary action. The four
steps explain the feature, prepare prerequisites, offer optional enrollment and
test without submitting. Illustrations are transparent raster assets; interface
text remains selectable/localized. Keep storage/privacy explanations precise:
speech recognition is local, but requests still reach the OpenCode server.

Search destinations `voice-more`, `voice-setup-prepare`, `voice-setup-profile` and
`voice-tts` reveal their existing control without invoking it. Each full-screen
flow owns its own `SettingsPanel` so search highlighting/scrolling stays inside
the visible surface. Native/system capabilities retain their platform gates.
