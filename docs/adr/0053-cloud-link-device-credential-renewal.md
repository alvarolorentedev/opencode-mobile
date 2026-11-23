# ADR 0053: Cloud Link device-credential renewal and session step-up

- Status: Accepted
- Date: 2026-11-23
- Deciders: maintainers
- Supersedes: —
- Related: [Cloud Link](../product/cloud-link.md), [API contract](../architecture/api-contract.md#cloud-link-sessions-and-device-credentials), [`shared/protocol/cloud-link/connect.ts`](../../shared/protocol/cloud-link/connect.ts), [`features/cloud-link/state/connect/access.ts`](../../features/cloud-link/state/connect/access.ts)

## Context

The control plane classifies Cloud Link sessions as `web`, `mobile` or `legacy`.
Machine access previously accepted only the session bearer. Legacy sessions need
a device credential step-up, web sessions never authenticate on that endpoint,
and stored credentials can expire or be rejected. The store claim is the only
silent way to obtain a mobile session without asking the user to sign in again.
Old connectors can also replace a machine with a new `machine_id` and
`server_url`, so the client can no longer reject every identity change.

## Decision

Renewing `/v1/machines/:id/access` prefers the stored HTTP Basic device
credential. Bearer remains the fallback for a missing credential or a new
session. A `403` with `code: "legacy_session_step_up_required"` retries once with
Basic. A rejected `401` credential, or a missing credential, re-verifies the
stored store proof at `/v1/subscriptions/claim` and retries access with the
resulting mobile session. `503` and transient `409` responses use bounded
backoff and never discard a working profile.

A pairing claim without `device_secret` is valid. The client keeps the saved
profile, verifies the store proof, then requests access and persists the rotated
credential. A replacement `machine_id`, `server_url` or hostname replaces the
affected profile atomically. Access replacements use the requested machine as
the previous profile; claim replacements require a unique same-control-plane
machine-name match, otherwise a new profile is added without deleting anything.

The client consumes runtime error codes and stores no deployment deadlines.
Renewal is scheduled from a local `renewAt` target derived from the stored
`expires_at`; neither value authorizes a request. Session tokens and device
secrets stay in SecureStore and are never logged.

## Consequences

Renewal works before and after the legacy windows without a flag day, and a
retired machine no longer leaves a stale profile. A Basic-first policy means the
step-up branch is normally defensive; it is reachable when the local expiry
schedules a Bearer attempt. The machine-name replacement heuristic can leave an
old profile behind when names are duplicated, which is safer than deleting a
working connection. Inline retries lengthen a failed access by a few seconds
before the existing foreground retry.

## Alternatives considered

- **Bearer first:** keeps the old path and exercises step-up normally, but sends
  legacy sessions into a guaranteed denial and contradicts the preferred Basic
  credential.
- **Reject every changed machine identity:** protects against a compromised
  control-plane response, but breaks legacy connectors that must replace a
  machine and leaves users unable to reconnect.
- **Hardcode the production deadlines:** couples the client to deployment
  configuration and causes a flag day when the dates move.

## Follow-up

- [x] Update the Cloud Link product doc and API contract.
- [x] Add protocol, recovery, replacement and log-hygiene tests.
- [ ] Exercise the step-up flow against staging before the production session
  deadline and validate the changed E2E mock with a human reviewer.
