# iOS quick actions, Live Activities, and widget parity

Central place for the **iOS home widget / Lock Screen gap** and everything
needed to close it later. iOS quick actions are implemented (dynamic items only).
Home/Lock Screen widgets remain deferred. This fork adds an opt-in local-only
Live Activity without an App Group; native/device acceptance is still required.
See [ADR 0023](../../adr/0023-opt-in-local-ios-live-activities.md).

Do not duplicate this list elsewhere. When iOS widgets land, update this file and
the docs it references.

## Current shipped state

- Quick actions (iOS + Android):
  - `shared/platform/quick-actions.ts` wraps `expo-quick-actions` (dynamic-only; no config
    plugin, no static shortcuts).
  - `features/sessions/model/quick-action-items.ts` selects up to three recent/running sessions;
    `features/sessions/state/use-native-surfaces.ts` publishes a New chat item plus those
    sessions, debounced and only while foregrounded (Android throttles dynamic
    shortcut updates in the background).
  - `features/sessions/state/use-quick-action-route.ts` resolves a tap through the existing
    `features/sessions/ui/session-link-screen.tsx` deep-link resolver, so connection scope, project
    switching, and session validation match notifications.
- Android home widget: `react-native-android-widget` +
  `features/widgets/ui/session-widget.tsx` + `features/widgets/background.tsx`, fed by the
  bounded snapshot in `features/widgets/model/widget-snapshot.ts` /
  `features/widgets/services/widget-snapshot-storage.ts`.
- Android now has Latest replies, Awaiting actions and current-chat Plan progress.
  Future iOS home widgets should consume the same bounded, redacted sections.
  Lock Screen widgets must omit reply/request/step text and titles.
- iOS Lock Screen and home screen widgets: **missing**. Local-only Live Activities
  are experimental and opt-in; continuous remote updates remain deferred.

## Missing for iOS widgets

1. **Dependency** — add `expo-widgets` plus its `@expo/ui` peer (both bundled in
   Expo SDK 58) with `npx expo install expo-widgets @expo/ui`. `expo-widgets`
   57.x supports iOS home screen families (`systemSmall`/`systemMedium`/
   `systemLarge`/`systemExtraLarge`) and Lock Screen accessory families
   (`accessoryCircular`/`accessoryRectangular`/`accessoryInline`), plus Live
   Activities. SDK 58 also has an opt-in Android renderer; retain the current package for
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
   a feature-owned iOS renderer) using `createWidget` and
   `@expo/ui/swift-ui`. The widget runtime is isolated: no hooks, no imports, no
   async work; only `@expo/ui/swift-ui` components and props passed by the app.
   Use the `widgetURL` modifier to deep link a tap to a session link (the same
   `opencodemobile://session/...` shape built by `shared/contracts/session-link.ts`).
4. **Feed it** — call `Widget.updateSnapshot(props)` from the provider
   (`features/sessions/state/use-native-surfaces.ts`) with the same data as the Android
   snapshot. iOS throttles timeline reloads; the widget shows last-known state
   with its `updatedAt` timestamp.
5. **Apple / signing** — create the widget extension App ID and the App Group,
   regenerate the distribution profile with the App Groups capability, and add
   the extension to the manual-signing release pipeline in
   `.github/workflows/release.yml` (`ExportOptions.plist`
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

## Live Activities (experimental local-only opt-in)

Build with `EXPO_IOS_LIVE_ACTIVITIES=1` to include the iOS implementation of
`modules/opencode-activity` and its CNG-generated WidgetKit extension. Default
store builds leave this flag unset. The notifications feature reuses its existing
observations and scope aggregation; iOS is V2-only. Android behavior is unchanged.

The Lock Screen and Dynamic Island show generic translated status, task counts,
and elapsed time. Session titles, tool/request/reply text, credentials, and server
URLs are not sent to the extension. Taps use the existing scoped session link;
permissions, questions, and all mutations stay inside the app. Notification-alert
permission is separate from the system Live Activities setting.

The route's connection identity is a one-way reference, not the reversible
canonical scope; it resolves only against saved/current app-owned connections.
The opt-in build's `opencodemobile-activities` scheme keeps activity taps distinct
from a separately installed upstream app. Legacy links retain their normal route.

Starting requires the foreground. Backgrounding shows paused/stale state instead
of promising live delivery. Foreground reconciliation resumes verified updates;
scope cleanup, terminal state, disabled authorization, and dismissal are handled
by the existing coordinator plus native lifecycle. Ordinary completion alerts
remain enabled independently. No background mode or keepalive service is added.

This implementation deliberately avoids the App Group required by Expo Widgets'
shared JavaScript runtime; see [ADR 0023](../../adr/0023-opt-in-local-ios-live-activities.md).
Continuous progress after suspension or termination still needs a separately
approved APNs sender and Apple provisioning; no push channel is implemented here.

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
- Experimental Live Activity: foreground work appears; paused state is honest
  after backgrounding; foreground restores it; completion freezes elapsed time;
  dismissal does not restart the same cycle; multiple connections preserve the
  remaining work when one disconnects; taps select the correct connection/project.
- Inspect every activity presentation before unlock: no private titles, request
  details, or commands, and no mutation buttons. Check light/dark, text scaling,
  VoiceOver, declined notification permission, and disabled system Live Activities.

## Rollback

Remove the `expo-widgets` plugin entry (or clear `EXPO_IOS_WIDGETS`), revert the
profile/`ExportOptions.plist` additions, and re-run `prebuild:ios`. The extension
target and App Group entitlements disappear with the generated project; placed
widgets disappear with the next release. No JS or persistence migration is
involved.
