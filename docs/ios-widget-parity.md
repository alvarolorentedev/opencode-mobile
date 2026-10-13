# iOS quick actions and widget parity (deferred)

Central place for the **iOS home widget / Lock Screen gap** and everything
needed to close it later. iOS quick actions are implemented (dynamic items only);
the iOS **widget extension** is deliberately deferred because it needs an Apple
Developer App Group, a second provisioning profile, and real-device validation.

Do not duplicate this list elsewhere. When iOS widgets land, update this file and
the docs it references.

## Current shipped state

- Quick actions (iOS + Android):
  - `lib/quick-actions.ts` wraps `expo-quick-actions` (dynamic-only; no config
    plugin, no static shortcuts).
  - `providers/quick-action-items.ts` selects up to three recent/running sessions;
    `providers/use-native-surfaces.ts` publishes a New chat item plus those
    sessions, debounced and only while foregrounded (Android throttles dynamic
    shortcut updates in the background).
  - `hooks/use-quick-action-route.ts` resolves a tap through the existing
    `app/session/[id].tsx` deep-link resolver, so connection scope, workspace
    switching, and session validation match notifications.
- Android home widget: `react-native-android-widget` +
  `widgets/session-widget.tsx` + `widgets/session-widget-task.tsx`, fed by the
  bounded snapshot in `providers/widget-snapshot.ts` /
  `providers/widget-snapshot-storage.ts`.
- Android now has Latest replies, Awaiting actions and current-chat Plan progress.
  Future iOS home widgets should consume the same bounded, redacted sections.
  Lock Screen widgets must omit reply/request/step text and titles.
- iOS Lock Screen and home screen widgets: **missing**. iOS Live Activities are
  also missing (and deferred; see below).

## Missing for iOS widgets

1. **Dependency** — add `expo-widgets` plus its `@expo/ui` peer (both bundled in
   Expo SDK 57) with `npx expo install expo-widgets @expo/ui`. `expo-widgets`
   57.x supports iOS home screen families (`systemSmall`/`systemMedium`/
   `systemLarge`/`systemExtraLarge`) and Lock Screen accessory families
   (`accessoryCircular`/`accessoryRectangular`/`accessoryInline`), plus Live
   Activities. Its Android side is an empty stub in SDK 57; do not use it for
   Android.
2. **Config plugin entry** in `app.config.ts`, gated on an opt-in build flag
   (for example `EXPO_IOS_WIDGETS=1`) until Apple-side provisioning exists:
   ```ts
   ['expo-widgets', {
     bundleIdentifier: 'app.getopencode.mobile.ExpoWidgetsTarget',
     groupIdentifier: 'group.app.getopencode.mobile',
     widgets: [{ name: 'SessionWidget', displayName: 'OpenCode tasks',
       description: 'Recent OpenCode tasks and their status.',
       ios: { supportedFamilies: ['systemSmall', 'systemMedium',
         'accessoryRectangular', 'accessoryCircular'] } }],
   }]
   ```
   The development variant (`app.getopencode.mobile.dev`) needs its own
   extension bundle id and App Group.
3. **Widget tree** — a `'widget'`-directive component (for example
   `widgets/ios/session-widget.tsx`) using `createWidget` and
   `@expo/ui/swift-ui`. The widget runtime is isolated: no hooks, no imports, no
   async work; only `@expo/ui/swift-ui` components and props passed by the app.
   Use the `widgetURL` modifier to deep link a tap to a session link (the same
   `opencodemobile://session/...` shape built by `lib/session-link.ts`).
4. **Feed it** — call `Widget.updateSnapshot(props)` from the provider
   (`providers/use-native-surfaces.ts`) with the same data as the Android
   snapshot. iOS throttles timeline reloads; the widget shows last-known state
   with its `updatedAt` timestamp.
5. **Apple / signing** — create the widget extension App ID and the App Group,
   regenerate the distribution profile with the App Groups capability, and add
   the extension to the manual-signing release pipeline in
   `.github/workflows/ios-release.yml` (`ExportOptions.plist`
   `provisioningProfiles` entry plus a second profile/GitHub secret). The plugin
   writes `extra.eas.build.experimental.ios.appExtensions` for EAS builds, which
   this repo does not use.
6. **Prebuild + native regeneration** — run `npm run prebuild:ios` after the
   config change (`ios/` is gitignored and regenerated on every build).

## Privacy requirements (must match the Android widget)

- Lock Screen accessory widgets show status and counts only, never session
  titles, because the Lock Screen renders before unlock-based authentication.
- No approve/deny, reply, abort, or auto-approve affordances on any widget.
- Widget taps only route; all mutations stay in the app. No credentials or
  server URLs are ever passed to the extension.

## Live Activities (also deferred)

`expo-widgets` can start Live Activities, but without APNs push-to-start/update
infrastructure an activity goes stale as soon as the app is suspended: the
system throttles local updates and the app only gets opportunistic background
time. Android's promoted ongoing notification (`modules/opencode-activity`)
already covers the equivalent surface. Revisit only if a push channel is
explicitly funded and approved.

## Acceptance tests (device, iOS 17+)

- Quick actions: cold start from a session item opens that session; a session
  owned by another saved connection switches to it first; New chat creates a
  session; labels are correct in light/dark and at larger text sizes.
- Widget: the widget gallery shows the widget; adding it before the app has run
  shows the empty state; after the app runs it shows the last snapshot with an
  updated time; tapping a row opens the session; the Lock Screen accessory shows
  status only.
- VoiceOver reads the widget and quick action names; screen reader focus is not
  trapped.
- Battery: no unexpected widget timeline reloads while the app is backgrounded
  (system budget); no new background modes.

## Rollback

Remove the `expo-widgets` plugin entry (or clear `EXPO_IOS_WIDGETS`), revert the
profile/`ExportOptions.plist` additions, and re-run `prebuild:ios`. The extension
target and App Group entitlements disappear with the generated project; placed
widgets disappear with the next release. No JS or persistence migration is
involved.
