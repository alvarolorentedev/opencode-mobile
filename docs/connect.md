# Cloud Link

## Manual setup and local V2 pairing

Settings and onboarding share an address → details flow. Continue probes without
switching the active connection. Confirmed V2 hides Username (Basic auth uses
`opencode` internally); V1 shows it. Authentication-blocked detection asks for
credentials and offers a collapsed custom username, then probes again on save.
Back, Change and retry preserve fields. Name is optional and defaults to the
normalized hostname. Edits save without automatically reconnecting.

On Android/iOS, the **Scan QR code** choice is a dedicated local setup flow that
accepts the code shown by `opencode pair`. The phone and server must share a
reachable network; the server must listen beyond localhost. It reuses the native
permission gate and scanner without any Cloud Link subscription, and never falls
back to the manual address form. FOSS builds omit the camera module and keep
manual address entry. Camera denial or Back returns to the connection method
chooser; backgrounding suspends the preview. A successful scan saves and connects
automatically. Invalid codes allow rescan; expired/used codes ask users to run
`opencode pair` again. A failed save or connect keeps the redeemed credential and
offers Retry plus Scan again without re-pairing.

The provider handles pairing and persistence; protocol validation/redemption live
in `lib/opencode/pairing.ts`. Current one-use codes become session-token passwords;
older V2 credential QR formats remain supported. Failed save/connect retries reuse
the credential and existing profile ID. See [API contract](api-contract.md#local-v2-pairing).

## Cloud Link subscription flow

Cloud Link is the feature previously named Connect. The public name appears in
pairing, subscriptions, machine management and camera permission copy. Existing
`connect` code identifiers, translation keys, storage keys, entitlement/product
IDs and the `opencodemobile://pair` protocol remain compatible.
Native subscription titles come from the stores; update their display names to
Cloud Link in the store consoles while retaining the existing product IDs.

Cloud Link is an optional native alternative to manual server setup. Settings,
onboarding and the independent `pair` route reuse the same provider flow.
Account creation is invisible: a verified App Store or Google Play subscription
issues the Cloud Link session. There is no signup, login or token-entry step.

## Environment and native prerequisites

Cloud Link automatically chooses between two fixed trusted environments:
`https://api.opencodecloud.link` for real purchases and
`https://apistaging.opencodecloud.link` for test purchases. There is no manual URL
editor or build-time URL override. The last resolved environment is persisted as
non-secret metadata; unknown legacy/custom URLs are discarded during hydration.

The service domain is separate from the app website, `getopencode.app`. This is
a clean cutover: the old `api.getopencode.app` and `apistaging.getopencode.app`
control planes and pairing links are no longer trusted. A remembered old
environment resets to the new production default. Old URL-scoped secure sessions
and pending QR records are not copied into the new environments; existing saved
profiles remain stored but cannot reconnect through an old control plane. Use
Restore on the new service or pair with a fresh connector QR to recover access.
Machine URLs continue to come directly from backend responses.

The public catalog is cached in memory for five minutes per trusted environment;
concurrent reads share a request and callers receive independent copies. Failed
refreshes are not cached. Concurrent claims of the same native proof in the same
environment share verification, but completed grants are never cached. Existing
secure-session expiry, explicit Restore and server-rejection recovery remain
authoritative; this does not change tunnel traffic or realtime behavior.

Release the updated app only after both new endpoints are available with the
existing subscription and pairing contracts. DNS, Worker publishing and store
notification configuration are managed in the separate Cloud Link service repo.

Google purchase metadata does not identify a test buyer locally. The app first
submits a new or rediscovered transaction to production. Only its exact verified
`403` response `Google test purchases are disabled in this environment` routes the
same transaction to staging. Ordinary entitlement, network, configuration and
verification failures never trigger that fallback. Even with a remembered staging
preference, a new real Google purchase resolves through production. StoreKit's
native `environmentIOS=Sandbox` selects staging; other transactions start at
production. Both stores still require successful backend verification.

The provider switches after releasing its operation lock and reloads the catalog
and environment/store-scoped session and pending QR. It retains the native proof
in memory for continuation, keeping secure-save/finalization retries in the same
verified environment. Redirect signals grant no access and never finalize a
transaction. QR links may reference only the two fixed URLs and cannot route store
proofs or grant an entitlement. A QR from the other subscription environment is
rejected; open a fresh QR from a connector running in the matching environment.
Never put product IDs or private verification credentials in Expo
configuration. The environment's `GET /v1/subscriptions/catalog` supplies plans,
Apple products and Google product/base-plan/offer IDs. Missing configuration or
native product metadata shows an unavailable error. Catalog plans and verified
sessions recognize `cloudlink`, retaining `connect` for legacy compatibility.
Returning to the foreground after failed initialization preserves the error
and Retry action. Retry closes the failed native connection and restarts store
initialization, offer loading and existing-purchase recovery. Checkout stays
disabled until initialization succeeds. A purchase already awaiting verification,
secure saving or finalization retains its checkpoint and resumes through the
existing recovery path.

`expo-iap` 5.8.2 requires a native development/store build. Rebuild after adding
its plugin. Expo Go and ordinary web cannot purchase or restore. Keep Expo SDK
57's generated native deployment targets and toolchain; don't replace them with the
standalone IAP library's compiler. Android requires Java and an Android SDK.
The separate development app IDs must match the backend/store configuration
for that environment; a production store product cannot be tested under an
unregistered development bundle/package ID.

Apple prerequisites: auto-renewable subscription group, In-App Purchase
capability, sandbox/TestFlight testers, backend verification credentials and V2
notifications. **Keep Family Sharing disabled.** Shared Cloud Link ownership is not
supported. Family-shareable native products are not offered by the app.
Google prerequisites: active auto-renewing base plan, eligible offers when
advertised, license testers/test-track build, backend verification credentials
and authenticated RTDN. Local StoreKit simulation is not server-verifiable.
Store-console setup and backend deployment are external to this mobile change.

Google subscription acknowledgement is owned by the control plane. The server
persists the verified grant, acknowledges Play, and retains a durable
`acknowledgement_pending` retry across claim, notifications and reconciliation; a
`200` grant can return `acknowledgement_pending: true`. The app must never
acknowledge a Google purchase itself: Play's guidance is to acknowledge from the
secure backend when one exists, and a client `acknowledgePurchase` cannot safely
no-op a purchase the backend already acknowledged. Mobile finishes only the
StoreKit transaction on iOS, where no server acknowledgement API exists. Claim
safely recovers the same store ownership when repeated, including when a client
acknowledgement from an older build lands first.

## Add connection and pairing UI

Settings exposes the consolidated Cloud Link section directly below AI &
Providers, and only for installs that came from the app stores. It folds in the
exposed-services management that previously had its own Settings row. Its
compact summary displays verified access status. Inside the section the order is
status, the connector's exposed services (active Cloud Link connections only),
the Subscription action group, and Machines last, followed by the Learn more
footer row. The Subscription group holds native offers and Subscribe when
inactive, Manage subscription and one Restore purchases. Manage
subscription opens App Store subscriptions on iOS or the current app package's
Google Play subscriptions page on Android, without guessing a product from
catalog offers. Cancellation and billing changes happen in the native store. The
date denotes paid-through access, not automatic renewal or cancellation state.

Inactive access reuses native offers and Subscribe. The section always has one
explicit Restore purchases action, plus existing progress/error/notice/Retry
feedback. Conflicting store operations disable actions. Your machines closes the
sheet and opens `pair?mode=manage`; opening Cloud Link alone never requests
camera access, pairs a machine, purchases, or performs interactive Restore.

`lib/connect-install.ts` decides whether Settings may offer the section.
`isConnectStoreInstall()` resolves the iOS application release type and only
accepts `AppStore`, while on Android it accepts a resolved Play Install Referrer
call; the Play Store only answers that service for packages it installed, so
directly installed APKs and F-Droid/FOSS builds fail it and stay hidden. The
provider exposes the resolved flag as `connectSetup.storeInstall`, so the
Settings row never flashes for non-store installs. FOSS and production web retain
the existing Cloud Link availability gate, the development web E2E harness keeps
the section through `connectPilot.testing`, and the services subsection only
renders for an active Cloud Link connection.

Settings retains connection status and saved profiles. Add connection is the
single creation entry and opens three stacked choices: Scan QR code (local
network), Manual, then Cloud Link. Onboarding uses the same chooser and retains
Skip. Scan QR code opens its own full-screen camera flow
(`connection-scan-flow.tsx`); Manual opens the separate full-screen
Name/URL/Username/Password form. Cloud Link opens the guided assistant. Failed
manual connections retain the form and reuse the saved profile on retry; the QR
flow keeps its redeemed credential for its own retry.

Cloud Link opens a full-screen, four-step illustrated assistant outside the tabs:

1. **Learn** explains remote access, the computer prerequisite, and install →
   subscribe → pair.
2. **Computer setup** shows the copyable `opencodecloud.link` address and asks the
   user to download/open Cloud Link on their computer and leave its QR visible.
   Cloud Link is running is an explicit user confirmation, not installation
   detection. There is no Share setup action.
3. **Subscribe** shows native localized offers at normal body size. A single
   offer is a static summary; multiple configured offers retain selection. Restore
   purchases is a visible text link above the pinned Subscribe & continue button.
   Subscribe explicitly launches native store checkout and advances only after
   verified access, secure session saving and finalization complete. Cancellation,
   pending approval and failed verification/finalization stay on this step with
   the existing recovery controls. Opening the screen never purchases or restores.
4. **Pair** reuses the computer drawing with scanner corners, explains scanning
   and desktop approval, and offers Use pairing link above the pinned Scan QR code
   action. This action opens the existing scanner and only then requests camera
   permission. Denial or scanner Back returns to the illustrated Pair step;
   pairing links remain available without camera permission.

All steps share illustration/heading/subheading positions, scrollable content,
44-point secondary targets, safe-area padding and bottom-aligned primary actions.
Artwork is decorative and hidden from screen readers. Existing subscribers start
on Pair and skip subscription; access loss returns them to Subscribe. Back moves
through the assistant, while Close cancels the pending pairing and returns to the
shared chooser, where Manual remains available. No assistant completion marker is
persisted. App updates are blocked while pairing is focused.

Incoming deep links already supply a QR payload and preserve their direct
subscription/automatic-pairing continuation without the assistant or camera gate.
The route clears secret query parameters with `setParams` so it retains that
origin while the provider keeps the exact pending QR through purchase/Restore.
Store/session initialization remains explicit (`loading`, `ready`, `error`).
Scanning never pairs without provider-verified entitlement.

The camera unmounts during operations, overlays, lost focus and backgrounding.
Invalid/untrusted links show recoverable errors; dismissing resumes scanning.
The scanner appbar options action (`monitor-multiple`) retains the pairing-link
alternative, machine management and learn-more URL. The illustrated Pair step's
Use pairing link opens those same options. Unavailable cameras retain Retry.
Machine management stays in `pair?mode=manage`, also reached through saved
profiles and the Cloud Link section. Production web offers Scan QR code, Manual
and Cloud Link availability guidance; only the development web E2E harness
enables mocked Cloud Link. Purchase/Restore, credentials, activation and
environment routing remain provider-owned and unchanged.

## Purchase, Restore and pairing

The app renders native localized pricing, periods and eligible advertised offers.
Only an explicit Purchase tap invokes `requestPurchase`. Pending approval and
cancellation grant nothing. Google replacement purchases include the previous
subscription token and explicit `deferred` replacement parameters.

Only an explicit Restore tap calls `restorePurchases`, followed by
`getAvailablePurchases`. Startup, foreground, session recovery and reconnect
may query available purchases, but never synchronize StoreKit interactively or
open a purchase dialog. iOS queries explicitly use
`onlyIncludeActiveItemsIOS: true` and `alsoPublishToEventListenerIOS: false`.
Unfinished iOS transactions are inspected through the native pending-transaction
API. Client metadata never authorizes Cloud Link access.

Both stores follow this order:

1. Obtain a purchased/recovered native transaction. Apple uses the exact native
   StoreKit signed JWS (`purchaseToken`, or native `getTransactionJwsIOS` when
   needed); Google uses its purchase token.
2. Submit the proof to unauthenticated `/v1/subscriptions/claim`.
3. Validate the returned session and durably write it to SecureStore.
4. Apple only: call `finishTransaction({ purchase, isConsumable: false })` to
   finish the StoreKit transaction. Google is acknowledged by the control plane
   during claim with durable retry, so the app never acknowledges Play.
5. Automatically continue a pending QR, or recover owned machines.

A failed backend claim or secure write never grants access. Verification errors
identify the selected control plane. Subscribe stays disabled while a transaction
needs recovery; Retry and Restore reuse the existing purchase.
Production and test environments can advertise the same product ID, so an offer
alone does not identify the purchase environment. Google test purchases route to
staging automatically, including Purchase, Restore and silent restart recovery.
The desktop connector's QR must use that same environment.
Apple finalization retries reuse the saved session without buying again. For
Google, the control plane owns acknowledgement and retries it durably, so an
unfinished purchase is finalized server-side without any client acknowledgement.
After app termination, a rediscovered Apple transaction can be exchanged again
through the idempotent claim and finished. Store proofs are not stored
permanently. Session validity and paid-through entitlement are separate. When pairing or machine
access returns the exact `403` / `no active subscription` response, the provider
clears the cached Connect entitlement while preserving the identity and pending QR,
then silently reverifies an available native purchase and retries once. Google
test-purchase routing still resolves through production and back to staging. If
verification fails or the retry is rejected, the UI shows recovery instead of a
stale active-subscription banner. Other `403` errors and invalid QR tokens never
trigger this subscription recovery.

Pairing `403` responses with `code=capacity_reached` show machine provisioning/
cleanup guidance. Only the exact `no active subscription` response is displayed
as a rejected entitlement; other access denials use a generic denial message.
An unfinished backend allocation can cause capacity rejection on a repeated QR
claim even while the subscription remains valid.

Scan the connector QR or open its version-1 link:

```text
opencodemobile://pair?v=1&cp=<trusted-control-plane>&id=<pairing_id>&t=<pairing_token>&n=<machine_name>
```

The route ingests parameters into provider state and strips them from navigation.
Pending QR data lives only in secure storage for continuation, never AsyncStorage.
Purchase/Restore resumes that exact pending pairing after finalization. Claim
sends the bearer session and JSON `{pairing_token,device_name}`. Default device
names are iPhone or Android phone; the backend assigns credential identifiers.

Completed pairing/access responses are saved before normal connection switching.
Secure-save retries retain the completed response in memory and do not redeem or
purchase again. Restart during an ambiguous pairing can repeat the same claim;
owner-visible `machine_id` in `409`/`503` recovers through authenticated machine
access. Provisioning locks remain retryable. Explicit expiry/invalid-token errors
clear pending QR data and request a fresh scan, preserving the subscription and
session. The older backend's combined conflict/expiry/lock message is ambiguous;
retain that QR for explicit retry or replacement rather than guessing its age.
A new scan replaces pending QR data; closing the pairing flow clears it.

Scanner permission is requested on every native pairing entry before the camera
surface renders; denial cancels pairing. Deep links skip that gate because they already
carry a QR. Losing focus or backgrounding unmounts the preview. Missing iOS
lenses and startup timeout retain deep-link recovery. Pairing remains available
before onboarding completion.

## Machines, secure profiles and transport

`machine_id` is durable ownership identity. `/v1/machines/:id/access` must return
that exact ID; a mismatch is rejected before credentials are saved or state is
migrated. Existing machine hostnames and profile IDs/names/model preferences are
preserved. Device credentials may rotate. The provider copies validated
connection-scoped caches and migrates remembered sessions, favorites and pending
notification references to the new credential scope before switching. Old
non-secret cache/remembered-session copies remain for interruption-safe recovery.

`GET /v1/machines` exposes owned machines and `access_enabled`, including after
subscription expiry. Second-device Restore recovers store ownership and obtains
machine access without a new QR. Expiry preserves machine/profile records;
Purchase/Restore reactivates the same machine/tunnel/hostname. Reconnect paths
prepare Cloud Link credentials centrally. Foreground access refresh starts five
minutes before expiry, avoids repeatedly refreshing unchanged paid-through
credentials, and retries transient failures. Expiry still closes SSE/terminal
sockets and blocks all SDK/polling/background traffic.

Concurrent reconnect triggers (boot, foreground refresh, activation retry,
manual Reconnect, profile switch) join one in-flight connect when the server,
generation, and credentials match, so workspace discovery and contract probing
run once. A credential rotation that lands mid-flight updates the in-flight key
instead of letting a second stale attempt start.

Data-plane authentication failures are not retried in a loop. The realtime
subscription classifies failures (`lib/opencode/client/errors.ts`) and stops
its retry loop for `auth`/`entitlement`, notifying the provider once: Cloud Link
runs the same prepared credential recovery used by foreground renewal, while
manual connections surface an actionable error that requires an explicit
reconnect. Offline/timeout/tunnel-startup failures stay on the bounded backoff
path, and a foreground stream that goes silent without an error is
re-established by the liveness watchdog.

A same-machine credential rotation preserves the selected workspace, sessions,
transcript, worktrees, MCP state, terminal transports/renderers and cursor, and
the workspace editor selection and draft. Storage-scoped keys still migrate to
the rotated credential scope. A different server, machine, or manual edit keeps
the existing full reset.

Foreground return also recovers credentials that expired or went missing while
the app was closed/backgrounded. Recovery waits for native-store initialization
and unfinished subscription finalization before requesting access. Concurrent
reconnects share one access/save operation per environment and machine; retrying
a completed secure-save checkpoint does not rotate credentials again. Transient
automatic recovery failures retry after 60 seconds while foregrounded.
Live renewal reconnects the same machine without clearing the selected workspace;
saved profile rows refresh on credential changes and use machine identity for
their Active badge. Credential-scoped storage keys remain unchanged. Stale
recovery results cannot replace a newly selected connection.

After a pairing claim is securely saved (including ambiguous-claim recovery),
the first activation displays “Confirm this connection on your computer.” The
connector withholds tunnel startup until its owner approves. Mobile cannot
distinguish approval, denial, expiry and tunnel startup with the current API;
there are no new status requests or protocol fields.

Activation retries Cloudflare Error 1033, identified DNS resolution failures,
and connection timeout/reset errors with 3/6/12/15-second delays, capped at 15
seconds, within a 120-second elapsed budget including request time. No further
attempt is scheduled once that budget expires; an already-running request may
settle later. HTML 1033 responses are preserved before SDK parsing can discard
their body. Authentication/entitlement denials, invalid/unsafe URLs, TLS/certificate
errors and unclassified transport failures remain immediately actionable.
Generic fetch failures are ambiguous and are not retried. Manual connections
and general reconnects do not receive this startup wait.

Backgrounding pauses further activation attempts without resetting the deadline.
An overdue foreground return shows a neutral delayed state: “No approval yet.
Approve on your computer, or scan a fresh QR code.” Retry explicitly starts another
bounded activation using the saved profile and credentials, without reclaiming
the QR, refreshing the machine list or rotating valid credentials. “Scan the new
QR code on your computer” returns to the scanner and accepts the connector's
regenerated QR while preserving saved profiles. Foreground recovery cannot overlap
or restart a waiting/delayed activation. Teardown/environment changes cancel waits;
results for a different active connection cannot complete the old pairing flow.

Sessions are SecureStore records scoped by trusted environment and store; Apple
and Google identities never merge. Session/pending-QR storage requires an
unlocked device and uses device-only iOS accessibility. Profile credentials use
the existing device-only, after-first-unlock storage for background notifications.
Native backup exclusions remain. AsyncStorage contains only profile metadata:
`{controlPlaneUrl,machineId,machineName,deviceId,expiresAt}` plus ordinary
connection metadata/preferences, never bearer/proof/pairing/device secrets.

HTTP, SSE and native WebSockets talk directly to `server_url` using device
Basic auth. User sessions never reach the data plane and credentials never enter
WebSocket URLs. Existing SSE reconnect/polling fallback and manual connections
remain. Forget removes local credentials only; explicit machine deletion removes
local records only after the backend acknowledges successful cleanup.

## Validation

Subscription Settings flows cover dark/light mobile layouts, verified access
dates, store handoff through the E2E driver, sheet close/reopen, machine navigation,
QR-free Purchase/Restore, pending approval guards, and catalog failure/retry.
Store-wrapper tests verify iOS handoff, Android package identity without a guessed
SKU, and unavailable-build/identity errors. Provider-hook checks verify serialized
management, purchase exclusion, and verified-date exposure. These mocks do not
establish real store handoff or device accessibility. The added E2E flows require
explicit human validation under AGENTS.md. The user confirmed human validation
of the section and its five new E2E flows on 2026-10-09; real native store handoff
and device accessibility remain separate acceptance checks.

Subscription Settings verification on 2026-10-09: static CI (149 Vitest tests
plus the script suites), both fake-server self-tests, all 109 web E2E flows and
FOSS preparation checks passed. Dark/light screenshots at 390, 320 and 1440 px
showed the selected grouped-action layout without horizontal overflow or
uncaught browser errors in the new flows. Android development prebuild passed;
Gradle stopped because no Android SDK location is configured. Live store handoff,
native larger text and screen-reader acceptance remain unverified.

`tests/vitest/connect.test.ts` covers trusted catalog/API/proof/session contracts and the actual
claim → secure-write → finalization aggregation on both stores, including
failures, retries, rediscovered transactions, and bounded Cloudflare 1033 tunnel
startup recovery after pairing. It also tests catalog/base-plan/
offer selection, native JWS forwarding, Family Sharing exclusion, DEFERRED
replacement, URL safety, app identity/camera/build variants and WebSocket headers.
`tests/vitest/connection-profiles.test.ts` checks stable profile identity, credential rotation,
hostname preservation, rollback, secret exclusion and expiry.
Control-plane checks cover the fixed allowlist, URL normalization/rejection,
explicit pairing trust, and environment-isolated sessions and pending QR records.
Actual provider-hook checks on both stores cover automatic purchase routing,
duplicate Subscribe/error preservation, retained-proof Restore, and checkpoint
isolation during secure-save/finalization failures. Cloud Link E2E covers real buyers
returning to production from a remembered staging preference, test buyers routing
to staging through Purchase/Restore/restart, exact staging QR continuation, and the
absence of manual URL configuration. Updated E2E assertions and real Android
license-test recovery still require explicit human validation.

`tests/e2e/connect.spec.mjs` intercepts the trusted API, supplies deterministic
native-store metadata/events and forwards HTTPS connector REST to the existing
fake OpenCode server. SSE deliberately falls back to polling. The development
E2E build substitutes memory for secure storage; reload loses credentials.
Production web has neither this store driver nor credential persistence.

Run `test:ci:static`, `test:fake-server:self`, `test:e2e:web`, the Android
development build and an iOS development build. E2E changes require explicit
human validation under AGENTS.md, even when automated checks pass.

Google acknowledgement ownership validation on 2026-10-12: the app no longer
acknowledges Play purchases. It finishes only the StoreKit transaction on iOS,
while the control plane owns Google acknowledgement with durable retry.
`tests/vitest/connect.test.ts` asserts Android never calls `finishTransaction`; Cloud Link E2E
asserts purchase/Restore/recovery still claim and secure a session without a
client finalization step. Locally, static CI, both fake-server self-tests and the
39 Cloud Link E2E flows passed. The updated E2E assertions require explicit human
validation under AGENTS.md, and live Android license-test acknowledgement remains
a separate acceptance check.

Cloud Link recovery validation on 2026-10-11: static CI, both fake-server
self-tests and all 116 web E2E flows passed. The user explicitly confirmed live
renewal with one active connection row, panel close/reopen and selected-chat
continuity, plus Android background/resume and full relaunch on a build containing
this fix. Android development prebuild passed locally; Gradle compilation remains
unverified here because no Android SDK is configured.

Automatic-routing validation on 2026-10-04: static checks, both fake-server
self-tests and all 82 Chromium flows passed. Actual provider-hook checks cover
both stores. The Android development build reached Gradle configuration but
stopped because no Android SDK is configured on this machine. Live Google
license-test Purchase/Restore and explicit human E2E validation remain pending.

Stale-entitlement recovery validation on 2026-10-04: static checks, both
fake-server self-tests and all 89 Chromium flows passed. Provider-hook regressions
cover both stores, renewed/expired/missing purchases, repeated rejection, exact
QR preservation and Google test routing across environments. Android development
prebuild passed; Gradle with the installed JDK 17 stopped because the Android SDK
location is not configured. Live Android purchase/QR recovery remains unverified.

Validation recorded on 2026-10-02:

- Static checks and both fake-server self-tests passed.
- Chromium: all 61 E2E flows passed, including subscription recovery, save-only
  retries and credential rotation. Mobile/desktop screenshots showed no overflow;
  the purchase flow reported no browser runtime errors.
- Android development `assembleDebug` passed for ARM64, using the existing JDK 17
  and a temporary command-line Android SDK. Other Android ABIs were not built.
- iOS development prebuild/CocoaPods and unsigned Debug simulator compilation
  passed, including the native IAP integration. Device signing was not tested.
- Explicit human E2E validation and live store/tunnel acceptance remain pending.

For the simulator compilation after a development prebuild:

```bash
EXPO_APP_VARIANT=development CI=1 npx expo prebuild --platform ios
EXPO_APP_VARIANT=development xcodebuild -workspace ios/OpenCodeMobileDev.xcworkspace \
  -scheme OpenCodeMobileDev -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Native acceptance remains separate: real sandbox/license-test purchase and
second-device Restore in each store, secure cold/locked-device relaunch,
finalization after interruption, Google plan replacement/lineage, renewal of the
same machine/tunnel/hostname, expiry/refund termination of active SSE/WebSockets,
camera allow/deny-cancel/unavailable, cold/warm deep links, manual/Cloud Link switching and
background notifications. Both variants share `opencodemobile`; verify routing
when both are installed. Mocked checks and simulator compilation do not establish
live purchase, Restore, acknowledgement or tunnel behavior.
