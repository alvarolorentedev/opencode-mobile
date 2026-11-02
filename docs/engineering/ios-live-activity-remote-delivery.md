# iOS Live Activity remote delivery

**Status: experimental reference implementation; not deployed or device-validated.**
The local/free-signing path remains the default. [ADR 0025](../adr/0025-managed-live-activity-relay.md)
records the narrower managed-mode decision, pending maintainer acceptance.

## Ownership and scope

`services/live-activity-relay/` is a standalone Node service using the repository's
installed `@opencode/client`. `modules/opencode-activity/ios/OpencodeActivityRemote.swift`
is its native registration consumer. No existing endpoint is assumed and no
Cloud Link, Expo push, or app connection credentials are forwarded to it.

Each enrollment authorizes up to 32 explicit `{source, sessionID}` pairs, possibly
across multiple servers. **These are operator-configured sessions, not the app's
connected-server aggregate.** Local foreground work starts the ActivityKit resource;
the relay alone writes all subsequent content and ends it when its authorized
sessions settle. Changing local tabs/connections does not change that remote scope.
New sessions require operator configuration and a relay restart. This limited
mode avoids silently uploading private local membership or competing writers.

The existing dashboard is unchanged. Remote presentation contains only localized
generic phase, count, and timestamps. Optional metrics stay absent when unverified.
Taps open the app root, not a private session/project route. Completion notifications
remain independent and best effort. There is no push-to-start.

## Configure and run the relay

Use the repository Node/npm requirements and install its locked dependencies.
Create a protected directory outside the repository, owned by the dedicated relay
OS user (directory mode 0700, configuration/key mode 0600). Run **one process**
per state file. Put this JSON in that directory, replacing every example value:

```json
{
  "port": 8788,
  "stateFile": "/protected/activities/state.json",
  "apns": {
    "environment": "sandbox",
    "bundleId": "your.containing.app.bundle.id",
    "teamId": "YOURTEAMID",
    "keyId": "YOURKEYID1",
    "keyFile": "/protected/activities/AuthKey.p8"
  },
  "sources": {
    "workstation": {
      "url": "https://opencode.example/",
      "headers": { "Authorization": "Basic OPERATOR_CONFIGURED_BASE64" }
    }
  },
  "owners": {
    "installation-one": {
      "credentialHash": "SHA256_HEX_OF_UNIQUE_RANDOM_INSTALLATION_CREDENTIAL",
      "locale": "en",
      "subscriptions": [{ "source": "workstation", "sessionID": "ses_REPLACE" }]
    }
  }
}
```

Generate each credential with at least 32 cryptographically random bytes encoded
as base64url; store its lowercase SHA-256 hex digest in the relay configuration.
Never reuse credentials across installations. A credential authorizes only its
configured scopes, not arbitrary source URLs or subscriptions from request bodies.
Supported locales: en, ru, es, hi, de, fr, zh, pt, ja (existing app translations).

Run from the repository root:

```sh
node services/live-activity-relay/server.mjs /protected/activities/config.json
```

It binds only to 127.0.0.1. Terminate public HTTPS at an operator-managed reverse
proxy and expose only `/v1/activity`. Disable request-body/Authorization logging;
apply proxy connection limits, 2 KB request limits and short timeouts. Configure a
supervisor, protected persistent volume, and host monitoring. Never run multiple
replicas against the JSON state file. The service itself logs no tokens, source
payloads, credentials, session IDs, or APNs response bodies.

Sources must be V2 servers with the installed SDK's finite
`session.log({sessionID, follow:false})` experimental endpoint available, plus
`session.inbox.list`, `permission.list`, and `session.form.list`. Source URLs must
be origin-only HTTPS (loopback HTTP is allowed for a colocated server); redirects
are rejected. Proxy path-prefix deployments are not supported by this reference
observer. Each read has a timeout; logs exceeding 10,000 events or missing
`log.synced` fail closed. The service replays durable execution events, including
retry, success, failure and interruption; it never infers completion from an empty
active-session list. Any failed source suppresses the entire aggregate update.
It polls on the server after each 15-second cycle, never in suspended mobile JS.
Unchanged successful observations are coalesced to at most one freshness update
per 45 seconds; actual phase/count changes can publish on the next cycle. Apple's
delivery budget may still throttle or drop these best-effort updates.

## Enable and enroll the app

1. Use a paid-team profile with Push Notifications for the containing app ID.
   APNs environment must match that provisioning (not a Cloud Link environment).
2. Set `EXPO_IOS_LIVE_ACTIVITIES=1` and
   `EXPO_IOS_ACTIVITY_RELAY_URL=https://relay.example/v1/activity` for the native
   build. The endpoint is public configuration, **not a credential**. The config
   rejects remote mode with `EXPO_IOS_DISABLE_PUSH_ENTITLEMENT=1`, FOSS, or E2E.
3. Using the installation's MDM managed-app configuration, set the string
   `OpencodeActivityCredential` to its unique base64url credential. iOS exposes it
   in `com.apple.configuration.managed`; it is never bridged to JS or embedded in
   the bundle. This requires managed enrollment; there is currently no self-service
   setup screen or credential deep link for unmanaged personal devices.
4. With the app foregrounded, start work to create the resource. Initial remote
   content is paused until the relay sends a verified observation of its scopes.
   An empty/settled allowlist ends it rather than pretending local work is tracked.

Only APNs update tokens are sent to the pinned relay. The APNs private key and
OpenCode source credentials remain on the host. The existing local Personal Team
command remains usable with the relay URL unset. No distribution or deployment
is performed by this integration.

## Registration, lifecycle and delivery

`PUT /v1/activity` and `DELETE /v1/activity` require `Authorization: Bearer ...`.
Both accept `activityId`, a 64-character lowercase-hex `generation`, and a positive
monotonic installation `revision`. PUT additionally requires hexadecimal `token`
and `startedAt` in Unix seconds. Native revisions are persisted; reenrolling a
reinstalled app requires a new installation credential/owner. Responses are empty:
200 accepted/idempotent, 400 invalid, 401 unauthorized, 409 stale/conflicting,
410 generation closed, 413 oversized, 429 rate limited. The limit is 30 authenticated
requests/minute/installation, with at most 100 configured installations.
The process caps the combined allowlists at 128 session subscriptions.

Token observation is restored on adoption/relaunch and covers rotations. Register
retries are bounded; suspended/terminated apps cannot promise rotation delivery.
Native dismissal/end cancels observation and best-effort unregisters. Removing or
changing managed enrollment ends the resource when the app can run. Operator
revocation removes/rotates the credential and restarts the relay. Missing cleanup
is bounded by a seven-hour absolute lease; the relay attempts an end in its final
minute and deletes expired tokens. iOS also enforces its own activity lifetime.

The relay persists registration revisions, token replacements, terminal latches
and a versioned enrollment fingerprint binding the owner ID, credential verifier,
canonical authorized scope set, and locale. Changing credentials or scopes under
the same owner ID invalidates its old registrations on restart; no old token is
adopted into the new enrollment. Legacy records without this binding are deleted
at startup and require fresh authenticated registration. The fingerprint contains
no raw credential; the credential verifier itself is not copied into state storage.
All state uses flushed atomic mode-0600 file replacement. Tombstones retain
only native IDs/revision, bounded by configured enrollment history. Retain this
file across restarts; losing it also loses replay protection. Registration during
a slow source read invalidates that result. Per-owner queues serialize APNs sends
and mutations; the whole authorized set becomes one complete replacement state.
Progress never follows a latched terminal result for that generation.

APNs uses TLS HTTP/2, ES256 P-256 provider JWTs, the containing app's
`.push-type.liveactivity` topic, priority 5, short expiration, and only Apple's
sandbox/production hosts. 429/5xx/transport failures wait at least 60 seconds;
expired progress is replaced by the newest state. 410 drops the invalid token;
a higher revision can install its rotation. Other permanent errors close the
registration; fix provisioning/configuration and start a new activity. Successful
APNs acceptance does not prove display.

`aps.timestamp`, `stale-date` and `dismissal-date` use Unix seconds. Swift content
`Date` numbers use Foundation's default 2001 epoch: Unix seconds minus 978307200.
Every push is a complete content state, with a 60-second stale date or final
content plus a five-minute dismissal date. Both the 4096-byte APNs limit and
combined attributes/content budget are checked. Native decoding also validates
phases, counts, progress, dates, copy, routes and encoded size before rendering.

## Verification and remaining acceptance

Offline coverage lives in
`features/notifications/__tests__/activity-relay.test.ts`: real installed SDK
response decoding, missing sync markers, authenticated HTTP registration,
scope isolation, token rotation, stale revisions, invalidation, restart/terminal
ordering, leases, locale/epoch/redaction/budgets, and an isolated real HTTP/2
server verifying headers and the JWT signature. Existing local/native source
and config-plugin tests cover preserved opt-in boundaries.

Offline tests are not device verification. Before enabling distribution, compile
the app and extension in Xcode, round-trip generated payloads through Foundation,
and verify on provisioned devices: initial token, rotation, managed-config changes,
background/suspended update/end, stale display, terminal ordering, dismissal,
relaunch, authorization changes, revoked credentials, missing sources and root
taps. Test process termination separately from force-quit. No IPA build, live
APNs send, purchase, release tag, or deployment is implied.

## References

- [ActivityKit pushes](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)
- [APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [APNs authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
- [Managed app configuration](https://developer.apple.com/documentation/devicemanagement/app-configuration)
- [Foundation reference date](https://developer.apple.com/documentation/foundation/nsdate/timeintervalsincereferencedate-swift.property)
- [Local iOS behavior](../product/parity/ios-widget.md)
