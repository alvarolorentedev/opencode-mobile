# iOS Live Activity remote-delivery proposal

**Status: PROPOSED / NOT IMPLEMENTED.** This document requests upstream decisions;
it does not enable remote delivery, define a deployed API, or authorize hosting.
No new remote credentials, requests, native push flags, token bridges, senders,
or background pollers are introduced. The app continues using its existing local
features and observation owners.

Current implementation and device limitations belong to [iOS parity](../product/parity/ios-widget.md)
and [ADR 0023](../adr/0023-opt-in-local-ios-live-activities.md). This proposal owns
only the additional contract, security, provisioning, and acceptance work needed
for remote updates after the app is suspended.

## Ownership must precede integration

The notifications feature owns activity coordination; the native ActivityKit
adapter owns the device resource. [Cloud Link](../product/cloud-link.md) owns
subscription, pairing, machine access, and connector services. Its control plane
is maintained in a separate service repository. Neither the mobile contracts nor
the inspected OpenCode SDK expose remote-activity registration. Backend support,
an authoritative execution-event producer, and a sender owner are unconfirmed.
Existing machine-access and connector-service APIs are not activity APIs.

The app presents **one aggregate activity across multiple connections/servers**.
APNs updates replace its complete content state: giving the same activity token
to independent servers lets their partial snapshots overwrite one another.
Maintainers must choose a trusted aggregation owner, or explicitly approve a
narrower single-owner remote mode and its interaction with local aggregation.
No implicit Cloud Link dependency or upload of other servers' state is acceptable.
Use an agreed authoritative event source, not a second mobile query/polling owner.

## Proposed logical contract

These are reusable operations and invariants, **not HTTP routes or an accepted
wire schema**. Transport, discovery, authorization, backend repository, and
version negotiation require maintainer agreement before any client calls exist.

| Operation | Required semantics |
| --- | --- |
| Register or replace | Authenticate the installation/owner; authorize each subscribed work scope; bind an opaque activity ID and generation to its current ActivityKit update token, monotonic registration revision, supported schema/locale, and bounded lease. The service allowlists the app/topic and verifies the APNs environment. Retries are idempotent; older revisions cannot restore superseded tokens. |
| Deliver | The agreed producer supplies authoritative, redacted state. One sender serializes/coalesces complete snapshots per activity, advances timestamps, and prevents old progress from following a terminal result. Explicitly reconcile local writes with remote writes and connection membership changes. |
| End or unregister | Owner-authenticated and idempotent, scoped to the activity/generation and registration revision. Clean up on end, dismissal, disablement, or ownership revocation when the app can run; leases and APNs invalidation handle missing client cleanup. A stale unregister cannot remove a newer registration. |

### Start in the app; update and end remotely

The first proposed remote phase starts activities in the foreground with
ActivityKit's `pushType: .token`; it does not add push-to-start or broadcast
channels. Observe `pushTokenUpdates` for initial asynchronous issuance and every
rotation, replace/invalidate the previous server token, and restore observation
of existing activities after relaunch. Tokens are per activity, not ordinary APNs
device tokens or Expo push tokens. Generation changes and native activity
replacement must invalidate obsolete subscriptions. Do not add a native token
bridge until an agreed registration consumer and its tests ship with it.

The sender uses HTTP/2 over TLS to Apple's sandbox or production APNs host, with
the ActivityKit token in the device path, `apns-push-type: liveactivity`, and
`apns-topic: <app-bundle-id>.push-type.liveactivity` for the containing app, not
the widget extension. Token authentication uses an ES256 provider JWT with `kid`,
Team ID `iss`, and current Unix-second `iat`; the private signing key stays on the
trusted sender. Provisioning determines the APNs environment; a staging Cloud
Link purchase environment does not determine it.

The `aps` envelope supplies `timestamp`, `event` (`update` or `end`), and a complete
`content-state` matching the accepted Swift type. Use `stale-date` for freshness
and final content plus an agreed `dismissal-date` when ending. Prefer priority 5
for ordinary progress; reserve 10 for justified urgent transitions. Respect
ActivityKit's update budget and user settings rather than assuming frequent
updates. APNs is best effort: acceptance is not proof of device display.

Handle invalidated tokens, including APNs `410`, without retry loops; distinguish
topic/environment/authentication errors from retryable failures. Bound retries
by expiry and usefulness, retaining only the newest eligible state. ActivityKit
attributes and content have a combined 4 KB limit; the APNs JSON body also has a
4096-byte limit. Test both byte budgets, including translated UTF-8 text.

### Content compatibility and optional metrics

Finalize the native/JavaScript DTO before proposing remote serialization. The
presentation work's agreed metric names are `completedSteps`, `totalSteps`,
`agentCount`, `toolCount`, and `filesChanged`; all are optional. Associated generic
labels (`progressLabel`, `agentsLabel`, `toolsLabel`, `filesLabel`, `updatedLabel`,
and `elapsedLabel`) are optional too. These names describe local presentation
compatibility, not a live remote API. Missing metrics mean unknown, not zero;
only bounded, verified counts and meaningful progress denominators may appear.
No task-step text, tool arguments, filenames, or inferred progress is implied.
Maintainers must agree aggregation, count semantics, localization ownership, and
compatibility before a sender encodes these fields.

**Date encoding is not interchangeable:** Swift `Date`'s default Codable numeric
representation is seconds since **2001-01-01 00:00:00 UTC**. APNs envelope fields
`timestamp`, `stale-date`, and `dismissal-date` are seconds since **1970-01-01
00:00:00 UTC**. For the same instant, the default Codable number is Unix seconds
minus **978307200**. Neither is Unix milliseconds. ActivityKit requires default
JSON decoding strategies; ISO strings or custom date strategies are not drop-in
substitutes. Any future golden payload must be generated and round-trip decoded
against the final Swift DTO using Foundation defaults. This proposal supplies no
unverified payload fixture or delivery claim.

## Privacy and trust boundaries

- Keep titles, prompts, commands, request/reply text, tool details, filenames,
  credentials, and server URLs out of remote presentation content. Generic status
  and bounded counts remain the default; even these need an approved data flow.
- The current session route includes a **project path**. Hashing its connection
  reference does not redact that path. Do not copy the full route into APNs or a
  relay by default. Agree an app-established immutable route or an opaque local
  reference, including cold-start resolution, before remote delivery. Taps only
  navigate after the app's existing scope/session checks; actions stay in-app.
- Treat activity tokens as sensitive routing capabilities, not proof of account
  or work ownership. Protect stored tokens, transport them over authenticated TLS,
  redact logs/telemetry, bound retention, and prevent cross-owner registration.
- Never ship the app owner's APNs private key to phones, extensions, or arbitrary
  user-hosted servers. Do not forward existing Basic passwords, custom gateway
  headers, or Cloud Link bearer credentials to a new relay.
- Remote content bypasses the app's local update validator. Enforce enum/count,
  string/byte, and route constraints at native decoding/rendering boundaries too;
  locally controlled generic labels are preferable to arbitrary sender copy.
- Consent, revocation, local/remote precedence, and treatment of disconnected or
  forgotten connections must be explicit. No private crash-log upload is required.

## Provisioning, testing access, and costs

Apple's free Personal Team cannot enable Push Notifications. Keep the existing
local-only Personal Team path usable; removing the push entitlement cannot test
APNs. A paid-program maintainer can provision and distribute an accepted beta
through **TestFlight**, allowing a contributor to test on their own iPhone without
buying a developer membership or sharing signing credentials. External testing
requires Apple's applicable beta review and an invitation; this proposal does
not authorize a release or upload.

APNs has **no per-notification fee**, but remote delivery is not zero-cost:
developer-program membership, event processing, hosting, storage, network traffic,
key management, monitoring, and maintenance remain operational responsibilities.
Do not promise unlimited throughput or free backend hosting.

## Upstream decision and acceptance checklist

- [ ] Name the backend repository, event producer, aggregation owner, APNs sender,
  and operational/key-custody owner; agree supported manual/Cloud Link connections.
- [ ] Resolve the single-aggregate/multiple-server model and local/remote write
  precedence; approve consent, routing privacy, DTO/versioning, and metric semantics.
- [ ] Agree authenticated registration/replacement, ownership checks, revocation,
  leases, environment/topic mapping, rate limits, retention, and failure handling.
- [ ] Approve app IDs, provisioning, protected sender credentials, operating costs,
  and a maintainer-owned device/TestFlight acceptance path.
- [ ] Offline: test final Swift Codable round trips, epochs, missing optional fields,
  redaction, bounds/byte budgets, token rotation and stale revisions, cross-owner
  rejection, leases, terminal ordering, and APNs error handling with dummy data.
- [ ] Provisioned device: verify token issuance/rotation, suspended update/end,
  delayed/out-of-order delivery, stale/terminal display, dismissal, authorization
  changes, revocation, multi-connection changes, and scoped cold/warm taps. Test
  process termination separately from user force-quit; do not promise delivery.
- [ ] Keep native compilation, offline mocks, local Personal Team testing, and live
  APNs acceptance as distinct results; follow existing repository validation gates.

An optional standalone reference sender is a separate maintainer decision, not
part of this change. If requested, keep it CLI-only with explicit send/dry-run,
Apple-host allowlisting, protected operator credentials, and real final-DTO and
isolated HTTP/2 tests. It needs APNs authentication but no public authentication
or registration endpoint. Offline tests must not be presented as live delivery.

## Apple references

- [ActivityKit push tokens, payloads, rotation, and update budgets](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)
- [Live Activity lifecycle, sandbox, and size limits](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
- [APNs HTTP/2 requests and environments](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [Provider-token authentication and key protection](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
- [APNs responses and token invalidation](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)
- [Notification payload privacy](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification)
- [Foundation reference date](https://developer.apple.com/documentation/foundation/nsdate/timeintervalsincereferencedate-swift.property) and [default Date encoding strategy](https://developer.apple.com/documentation/foundation/jsonencoder/dateencodingstrategy-swift.enum/deferredtodate)
- [Capabilities by program membership](https://developer.apple.com/help/account/reference/supported-capabilities-ios) and [membership details](https://developer.apple.com/programs/whats-included/)
- [TestFlight distribution and external testers](https://developer.apple.com/testflight/)
