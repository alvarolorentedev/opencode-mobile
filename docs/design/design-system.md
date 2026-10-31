# Design system

Related ADR: [0013 source-owned UI and complex forms](../adr/0013-source-owned-ui-and-complex-forms.md)

This is the implementation reference for new features. All application surfaces share the source-owned UI foundation. Specialized terminal, markdown and virtualized-list behavior stays in its existing owner.

Related: [Design section](README.md) · [Component inventory](component-inventory.md)
· [Storybook](storybook.md) · [Design QA](qa/README.md)

## Sources of truth

| Concern | Source |
| --- | --- |
| Authoritative palettes, fonts, typography and dimensions | `constants/ui-tokens.json` |
| Typed imperative projections | `constants/theme.ts` and `constants/design-tokens.ts` |
| Theme modes and six color presets | `constants/appearance.ts` |
| Generated Tailwind aliases and initial themes | `constants/ui-tokens.generated.css` |
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
through `usePalette()`, not direct `Colors.light` reads. Use semantic Tailwind classes for shared controls. Status always has text or an icon as well as color. Target
4.5:1 text contrast and 3:1 essential control/focus contrast; verify the actual
foreground/background pair, including muted text and every selectable preset.
Do not communicate disabled state through opacity alone: expose disabled
semantics and explain an unmet prerequisite near the control.

### Typography

Keep platform fonts; do not add a font dependency. App-shell titles use
`Fonts.display` with weight 700. Body controls use the shared Text typography roles;
code, commands and paths may use `Fonts.mono`.

| Role | Text role | Default size/line height |
| --- | --- | --- |
| Sheet title and category row | `title` | 16/24 |
| Section heading | `description` | 14/20 |
| Field value and switch title | `body` | 16/24 |
| Description, status, breadcrumb | `description` | 14/20 |
| Field label | `label` | 12/16 |

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
| Choose one value | `SettingSelectField` / `CatalogSelect` | Label and wrapping value; `compact` puts label/value on one row; searchable choices for long catalogs |
| Primary/secondary action | `Button` | CVA variants with a 48-point target and shared control radius |
| Edit a settings form | `SettingField` | Shared outline/radius; retain validation, secure entry and keyboard options |
| Adjust a numeric preference | `SettingSlider` / `NumericSlider` | Label, readable value, existing range, adjustable semantics and web arrow keys |
| Advanced settings | `SettingsDisclosure` | Labeled button with expanded state; search and attention states reveal its content |
| Category content | `OverlaySheet` + `SettingsPanel` | Stable title/Close header, keyboard-safe scrolling, safe-area padding, keyboard dismissal on open, Android Back and header-drag dismissal |
| Locate a searched setting | `SettingTarget` | Reveal, scroll, highlight and announce the matching label without changing its value |
| Short confirmation or choice | Existing dialog / `CatalogSelect` | Keep existing modal, auth and confirmation contracts |

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
inspection target. Server selection is made once on Settings home when multiple
servers exist; server category sheets show a read-only context caption instead
of repeating the selector, and preserve project selection where applicable.
Only connected servers are selectable; disconnected, connecting and unavailable
profiles stay in Connection management for reconnection.
Inspecting settings must not move the active chat or alter preference scope.

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

## Storybook catalog

Reusable presentation components have co-located stories under
`components/**/*.stories.tsx` and run in the web Storybook. The catalog is for
shared primitives and controls, not provider orchestration or full screens.

- Run `npm run storybook` for the local catalog.
- Run `npm run build:storybook` to verify the catalog builds.
- Use the real appearance provider and Uniwind theme; do not create a parallel
  visual wrapper.
- Cover the states that are hard to reach in the app: disabled, error, loading,
  long values, narrow width, light/dark, and accent presets.
- Add or update a story when a reusable primitive or shared control changes.

See [Storybook](storybook.md) for configuration and the story checklist.

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
translations and regression coverage. Reusable primitives need a Storybook
story and a passing `npm run build:storybook`. Update implementation docs when
behavior changes. E2E or fake-server changes require explicit human validation
under `AGENTS.md`, even after the automated gates pass.

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

## Source-owned components and styling

Reusables source in `components/ui/` comes from founded-labs/react-native-reusables
commit `385834c2196f8a303cbc9057d1ac768f3bde0a3b`, Uniwind registry, MIT.
Local adaptations preserve MaterialCommunityIcons, product typography, wrapping,
48-point targets, workspace context and modal-local portals. The component
inventory records ownership; do not regenerate over local adaptations.

Use the pinned registry CLI with an explicit component and styling engine:

```bash
npx @react-native-reusables/cli@0.7.1 add button --styling-library uniwind
```

Review upstream source and dependency changes before an upgrade. Never use
`--all`, `-y` or blind overwrite. Decline automatic dependency installation;
add only the selected component's required packages, keeping Tailwind v4 and
the installed Expo/native versions. The pinned CLI still lists older core
setup defaults. Reuse existing production components before adding
one. Standard variants use CVA and `cn()`; static presentation uses literal
Tailwind classes. Measured dimensions, safe-area/keyboard insets, animations,
and third-party renderer styles remain inline. Do not add a second styling
engine, font dependency, UI library or generic form/schema renderer.

The token JSON is authoritative. TypeScript projections and generated CSS do
not own independent values. Run `npm run gen:ui-tokens` after changing it;
`npm run gen:ui-tokens -- --check` detects stale generated output. Uniwind uses
light/dark theme names; the appearance provider applies both palette variable
sets when the accent changes. Preferences and OS appearance remain the only
appearance state owners. Navigation, system chrome and renderer props use the
same palette. Muted, primary and semantic text colors meet the contrast contract on all
base surfaces. Light green, blue and pink primary colors and the semantic
foregrounds receive small contrast corrections; the six preset hues and product
identity are preserved.

Complex forms use React Hook Form, Controller/useController and zodResolver.
Schemas live beside the owning Settings forms and reuse existing domain
validators. Requests and persistence stay in their existing provider actions.
Failed submissions retain values; form identity changes reset drafts. Simple
preferences, searches, pairing-link fields, editor buffers and chat drafts
keep their existing local/provider ownership. Validation messages are localized.

Generic confirmations use the shared AlertDialog and local useConfirmation
hook. OS permission and store dialogs remain native integrations. Full-screen
native modals preserve their window behavior and provide a named local portal
host; nested overlays dismiss before the containing form. Sheets share the
existing header-drag gesture and RN Primitives dialog semantics. NumericSlider
retains Expo's native slider plus its web keyboard adapter because the RN
Primitives native slider does not implement drag handling. Terminal accessory
buttons retain their DOM focus, repeat and modifier behavior.

## Validation and rollback

Use the existing validation gate and owning flow specs. New browser specs and
mandatory CI jobs are unnecessary for a foundation change covered by these
flows. See the [test-selection matrix](../engineering/validation/strategy.md#test-selection-matrix).

| Change | Minimum validation |
| --- | --- |
| Shared tokens or theme mapping | Generation check, appearance contrast/mapping tests, foundations stories |
| Primitive or shared settings control | Static checks, production Storybook story, owning flow spec |
| Complex form | Schema/control tests and the existing connection, provider, extension or Cloud Link flow |
| Dependencies, root providers, Metro or Vite | Full gate below, native exports and platform builds |

```bash
npm run gen:ui-tokens -- --check
npm run test:ci:static
npm run test:fake-server:self
npm run test:e2e:budget
npm run build:storybook
npm run test:e2e:web
npx expo export --platform android --platform ios --output-dir output/native-export
npm run build:development:android
npm run build:foss:android
npm run prebuild:ios
npm run build:ios:local
```

Signed distribution commands require the existing signing environment described
in [Development](../engineering/development.md). An unsigned Release simulator
build can check native compilation after iOS prebuild:

```bash
xcodebuild -workspace ios/OpenCodeMobile.xcworkspace -scheme OpenCodeMobile \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
```

For development prebuilds, use `OpenCodeMobileDev` for the workspace and scheme.
Review the rendered production stories; a successful Storybook build alone does
not verify focus, interactions or provider independence.

| Acceptance | Web | Android | iOS |
| --- | --- | --- | --- |
| Connection/authentication/extensions | Existing flows; errors retain draft and focus | Keyboard open, submit, Back, repeat submit | Keyboard open, submit, Back, repeat submit |
| Overlays and selection | Nested modal/select focus, Escape, Tab, restoration, scrolling and header drag | Hardware Back closes top overlay; modal-local portals and gestures | VoiceOver escape, stacked windows, gestures and safe areas |
| Appearance | Both schemes, six accents, system changes and reload | System appearance changes and navigation chrome | System appearance changes and navigation chrome |
| Accessibility/localization | Keyboard, 200% zoom, narrow viewport and long translations | TalkBack, maximum font/display size, touch targets | VoiceOver, largest accessibility text, touch targets |
| Specialized surfaces | Existing chat/diffs/project/terminal flows | Composer/terminal keyboard and native renderers | Composer/terminal keyboard and native renderers |
| Build/distribution | Expo export and Vite Storybook | Development APK, production/FOSS release and free dependencies | Native Release compilation and signed archive/export |

Device and store acceptance remains a release requirement even when automated
checks pass. Any edits to existing E2E tests require the explicit human
validation specified in `AGENTS.md`.

Rollback the migration as one change: revert its commit (or revert its merge
commit with `git revert -m 1 <merge-commit>`), restore the matching lockfile and
generated tokens, run `npm ci`, then rebuild web and native artifacts. Publish
through the existing release process. Persisted settings, credentials, sessions
and protocol formats are unchanged, so rollback needs no data migration. Keep
source, configuration and dependency rollback together.
