# Cloud Link

## Manual setup and local V2 pairing

Settings and onboarding share an address → details flow. Continue probes without
switching the active connection. Confirmed V2 hides Username (Basic auth uses
`opencode` internally); V1 shows it. Authentication-blocked detection asks for
credentials and offers a collapsed custom username, then probes again on save.
Back, Change and retry preserve fields. Name is optional and defaults to the
normalized hostname. Edits save without automatically reconnecting.

On Android/iOS, **Scan local QR code** inside manual setup accepts the code shown
by `opencode pair`. The phone and server must share a reachable network; the server
must listen beyond localhost. This reuses the native permission gate and scanner
without any Cloud Link subscription. FOSS builds omit the camera module and keep
manual address entry. Camera denial returns to manual entry;
backgrounding suspends the preview. A successful scan saves and connects
automatically. Invalid codes allow rescan; expired/used codes ask users to run
`opencode pair` again. Unreachable addresses offer manual entry and network guidance.

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
and Retry action; Retry reloads the store offers.

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

**Backend release blocker:** the sibling backend inspected for this change still
acknowledges Google purchases. Mobile is the sole finalization owner under the
corrected contract. Remove backend acknowledgement from claim, notifications,
reconciliation and recovery before full Android contract validation. Mobile
calls only `finishTransaction`, not a second acknowledgement operation. Backend
claim must safely recover the same store ownership when repeated.

## Add connection and pairing UI

Settings retains connection status and saved profiles. Add connection is the
single creation entry and opens two stacked choices: Pair with Cloud Link, then
Manual. Onboarding uses the same chooser and retains Skip. Manual opens the
shared full-screen Name/URL/Username/Password form with Save & connect. Failed
connections retain the form and reuse the saved profile on retry.

Cloud Link opens a full-screen camera surface, outside the tabs. On native, each
pairing entry requests camera permission before this surface (and its subscription
sheet) renders, including when Android reports a requestable denial; denial
cancels pairing and returns to the previous screen. Store/session
initialization is explicit (`loading`, `ready`, `error`); scanning and the
subscription overlay wait for recovery to settle. A verified subscriber scans
and automatically pairs, securely saves, and connects through the provider's
`pairLink` action. Non-subscribers see the shared subscription sheet with
benefits, native localized offers, Subscribe and Restore purchases over the
camera preview; the preview renders but scans never pair without an active
entitlement. Dismissing it clears the pending QR, dismisses the camera surface,
and returns to the chooser. Every new Cloud Link attempt checks entitlement again
and shows the sheet for a non-subscriber; dismissal is never remembered. Active
subscribers go directly to the camera surface without the buy/Restore sheet,
including when opening pairing again after a successful connection. No purchase
is started automatically. Deep links use the same continuation and retain the
exact pending QR for purchase/Restore; because they already carry a QR they skip
the camera-permission gate.

The camera unmounts during operations, overlays, lost focus and backgrounding.
Invalid/untrusted links show recoverable errors; dismissing resumes scanning.
A viewfinder frames the QR area and its hint replaces the old status chips. The
appbar hosts a single options action (`monitor-multiple`) instead of an inline
pair-link button: it contains the pairing-link alternative, machine management
for entitled users, and a learn-more link to `https://opencodecloud.link/`.
Unavailable cameras retain Retry. The subscription sheet, including store setup and purchase errors, contains
only purchase/Restore content and recovery controls. Pairing-link fallback belongs to the options sheet. Machine management lives in a separate `pair?mode=manage`
view, reached through the options action or saved profiles' Manage Cloud Link or
Your machines after Restore. Production web offers Manual and explains native Cloud Link availability;
only the existing web E2E harness enables mocked Cloud Link.

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
4. Call `finishTransaction({ purchase, isConsumable: false })`, finishing StoreKit
   on iOS and acknowledging Google on Android.
5. Automatically continue a pending QR, or recover owned machines.

A failed backend claim or secure write never finalizes the transaction.
Verification errors identify the selected control plane. Subscribe stays disabled
while a transaction needs recovery; Retry and Restore reuse the existing purchase.
Production and test environments can advertise the same product ID, so an offer
alone does not identify the purchase environment. Google test purchases route to
staging automatically, including Purchase, Restore and silent restart recovery.
The desktop connector's QR must use that same environment.
Finalization retries reuse the saved session without buying again. After app
termination, the unfinished native transaction can be rediscovered, exchanged
again through the idempotent claim and finalized. Store proofs are not stored
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

After a pairing claim is saved, the first connection retries Cloudflare Error
1033 with bounded 1/2/4/8-second delays while a newly started tunnel comes online.
Other connection errors remain immediately actionable; the saved profile can be
retried without scanning or claiming the QR again.

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

`test:connect` covers trusted catalog/API/proof/session contracts and the actual
claim → secure-write → finalization aggregation on both stores, including
failures, retries, rediscovered transactions, and bounded Cloudflare 1033 tunnel
startup recovery after pairing. It also tests catalog/base-plan/
offer selection, native JWS forwarding, Family Sharing exclusion, DEFERRED
replacement, URL safety, app identity/camera/build variants and WebSocket headers.
`test:connection-profiles` checks stable profile identity, credential rotation,
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
