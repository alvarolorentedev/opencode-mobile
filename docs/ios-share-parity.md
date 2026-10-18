# iOS share receive parity (deferred)

Central place for the **iOS inbound-share gap** and everything needed to close
it later. Android inbound sharing is implemented and shipped; iOS is
deliberately deferred because it needs an Apple Developer App Group, a generated
Share Extension target, EAS credentials, and real-device validation.

Do not duplicate this list elsewhere. When iOS lands, update this file and the
docs it references.

## Current shipped state (Android)

- Receive plugin: `expo-sharing` config plugin in `app.config.ts` with
  `android.enabled: true`, `singleShareMimeTypes: ['*/*']`, `multipleShareMimeTypes: ['*/*']`. The iOS block is
  intentionally absent.
- Staging: `providers/use-share-state.ts` calls
  `getSharedPayloads()` / `getResolvedSharedPayloadsAsync()` on mount and on
  `AppState` `active`, parses via `lib/share/parse.ts`, and stages an in-memory
  `SharedPayload` (bounded 10-minute TTL, never persisted).
- Routing: `app/+native-intent.ts` redirects the `expo-sharing` host to
  `/share`; every other deep link passes through.
- Preview: `app/share.tsx` shows text/link/attachment tiles, a current-chat destination, searchable conversation chooser
  with project labels/New chat, and Add to chat / Discard. Nothing is submitted here.
- Composer handoff: `components/chat/use-chat-view-controller.ts` consumes the
  confirmed payload into `draft`/`attachments` once the route is focused and
  connection/project/session match, preserving existing draft content. The
  composer still owns the explicit send.
- Web/E2E: `useShareState` is a no-op on web; the browser cannot receive native
  share payloads.

## Missing for iOS

1. **Config plugin iOS block** — add to the `expo-sharing` entry in
   `app.config.ts`:
   ```ts
   ios: {
     enabled: true,
     extensionBundleIdentifier: 'app.getopencode.mobile.ShareExtension',
     appGroupId: 'group.app.getopencode.mobile',
     activationRule: {
       supportsText: true,
       supportsWebUrlWithMaxCount: 1,
       supportsWebPageWithMaxCount: 1,
       supportsImageWithMaxCount: 5,
       supportsMovieWithMaxCount: 1,
       supportsFileWithMaxCount: 5,
     },
   }
   ```
   Values must match the actual Apple Developer team identifiers. The
   development variant (`app.getopencode.mobile.dev`) needs its own extension
   bundle id and App Group.
2. **Apple / EAS provisioning** — create the Share Extension bundle identifier
   and the App Group in the Apple Developer account; attach both to the
   provisioning profiles. The plugin writes
   `extra.eas.build.experimental.ios.appExtensions`, so EAS must be configured
   with the single extension target (see the `expo-share-intent` EAS note for the
   same pattern).
3. **Prebuild + native regeneration** — run `npm run prebuild:ios` after the
   config change (`ios/` is gitignored and regenerated on every build).
4. **`+native-intent.ts` host check** — confirm the generated extension opens the
   app with host `expo-sharing` (as documented by Expo); adjust
   `app/+native-intent.ts` if the emitted scheme/host differs.
5. **Simulator vs device** — simulator builds do not prove App Group signing.
   Device builds are required before this is considered done.

## Parity requirements (must match Android behavior)

- Text, URL, images, and files from the share sheet stage into `app/share.tsx`.
- The selected model's attachment capability is still enforced at send
  (`providers/use-prompt-lifecycle.ts`).
- The 10 MB per-file limit and URI allow-list still apply (shared via
  `lib/share/parse.ts`).
- Nothing auto-submits; the composer is the only send path.
- A cold start with an incomplete onboarding shows the "finish setup" state and
  retains the staged payload to the 10-minute TTL; Discard clears it.
- Warm shares (app already foregrounded) stage on the next `AppState` `active`.
- Web and Expo Go remain unaffected (no native extension).

## Known iOS limitations (accepted)

- Expo marks inbound sharing **experimental**. On iOS the share extension opens
  the main target rather than processing in a share `ViewController`, which is
  not officially supported by Apple and may change in a future iOS release.
  Expo's own assessment is that this is unlikely to cause App Store rejection,
  but it is a dependency risk to re-check at implementation time.
- Apple does not guarantee that a Share Extension can foreground its containing
  app; the payload is still recoverable on next active.

## Acceptance tests (device)

- Share text, a URL, an image, and a PDF from Safari/Photos/Files into the app on
  a signed device build and confirm the preview, project picker, and Add to
  chat flow.
- Cold start from a share while un-onboarded: verify the setup-needed state and
  Discard.
- Warm share: verify the composer is prefilled and never auto-sends.
- Oversize (>10 MB) and unknown-type items: verify the skip/warning copy.
- Verify the FOSS Android build is unaffected (iOS config is not built there).

## Rollback

Remove the `ios` block from the `expo-sharing` plugin entry and re-run
`prebuild:ios`; the extension target and App Group entitlements disappear with
the generated project. No JS or persistence changes are involved.
