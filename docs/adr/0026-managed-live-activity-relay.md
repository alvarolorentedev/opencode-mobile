# ADR 0026: Opt-in managed Live Activity relay

- Status: Proposed
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0024](0024-opt-in-local-ios-live-activities.md), [remote delivery](../engineering/ios-live-activity-remote-delivery.md)

## Context

Local observation stops when iOS suspends the app. No existing OpenCode or Cloud
Link API registers ActivityKit tokens. One aggregate cannot accept independent
partial writes from multiple servers. The requested reference implementation must
run without adding app UI or putting APNs signing keys on phones.

## Decision

Add a separately deployed, explicitly enabled reference relay and native client.
The operator enrolls each installation with a unique random bearer credential
through iOS managed app configuration. The public HTTPS endpoint is pinned in
the native build. The relay stores only the credential hash and authorizes a
fixed, operator-selected set of V2 server/session pairs per installation.

This intentionally narrower managed mode is independent of the app's local
connection membership. A foreground local task starts the native resource, but
the relay exclusively owns subsequent aggregate updates and termination. The
phone never submits source credentials, session identifiers, or local snapshots.
The relay observes verified V2 durable execution logs and pending interaction
APIs, then sends complete redacted state through APNs. Remote taps open the app
root, avoiding project paths in APNs. Default and Personal Team builds stay local.

## Consequences

The existing UI is retained. Operators can configure/deploy a complete bounded
reference path, but need managed-device enrollment, paid push provisioning, a
trusted host, source credentials, session allowlists, and real-device acceptance.
This does not offer self-service enrollment, arbitrary user-selected scopes,
push-to-start, or automatic new-session discovery. Those require a separate
product/auth decision, not reuse of Cloud Link credentials.

One relay process owns a protected state file. Horizontal scaling is unsupported.
Persisted revisions, terminal latches, finite leases, and APNs invalidation bound
token retention and prevent stale registration and progress resurrection.

## Alternatives considered

- **Shared build-time bearer secret:** rejected; every app installation could
  impersonate another and revoke its activity.
- **Cloud Link token forwarding:** rejected; no activity contract or authority.
- **Independent per-server senders:** rejected; partial snapshots overwrite the
  single complete aggregate.
- **New enrollment/settings UI:** deferred to preserve the current interface and
  keep this reference integration explicitly operator-managed.

## Follow-up

- [ ] Maintainers accept the managed scope/enrollment contract or design a separate
  user-facing enrollment flow before general distribution.
- [ ] Compile on Xcode and complete provisioned-device acceptance.
