# ADR 0041: Connector-enforced service access

- Status: Accepted
- Date: 2026-11-09
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md#connector-service-management-cloud-link), [Cloud Link](../product/cloud-link.md), [access contract](../../shared/contracts/service-access.ts)

## Context

An exposed service was reachable by anyone who held the tunnel URL, and the app
could only flip a private/public bit. The connector now owns sharing: it issues
a share capability, a write-only password and a deadline, and re-checks them on
every visitor request. The mobile app has to manage that state without being
able to weaken it, while every connector older than 0.20.0 keeps working
unchanged.

Two constraints pull against each other. A client that rewrites a protected
service without a policy would silently clear its protection — the connector
answers `409` with `connector_update_required` — and a client that infers the
mode from the legacy `access` field cannot tell `password` from `public`, since
both project to `public`.

## Decision

Gate the new surface on `GET /_cloudlink/version` advertising
`capabilities: ["service-access-v1"]`, never on the release string. Connector
0.20.0 is the first release that advertises it, but a fork or backport with the
capability works and a build without it stays legacy. Without the capability the
app keeps the private/public controls, hides the expiration and password
controls, sends no `access_policy`, and refuses to rewrite a service that
already carries one.

Treat `access_policy` as authoritative when present; `access` stays a legacy
projection. `prepareServiceDraft` in `shared/contracts/service-management.ts`
decides whether a policy is needed: always re-sent for a stored policy, created
for password mode or a non-legacy expiration, never for a plain edit of a legacy
service.

Anchor every deadline on `server_time` from the list response, advanced by the
local time elapsed since it arrived, so countdowns and computed expirations
track the connector rather than the phone clock. A password is typed once, never
prefilled and never echoed by any response; omitting it from a PUT means "keep
the stored password". Share URLs append `?cl_share=<share_token>`, and an
external share without a token is reported as unavailable instead of falling
back to a bare link.

## Consequences

- Older connectors keep the exact pre-policy behavior; the only new wire fields
  sit behind a capability they do not advertise.
- A protected service cannot be edited by a client without the capability. The
  app shows the connector's message and never retries without a policy, because
  that retry is the downgrade the connector is refusing.
- Editing an expired share requires an explicit new deadline or "No expiration",
  so nothing is extended silently.
- Revocation is a separate endpoint from delete: the share, password and
  deadline are cleared while the service keeps routing for paired devices.
- The fake connector mirrors the capability, the clock, the policy, revocation
  and the 409, so the contract tests and the browser flows exercise the real
  contract rather than a simplified one.

## Alternatives considered

- **Gate on `api >= 4` or the release string:** a build that ships the
  capability without the expected number would be locked out, and a build that
  bumps the version without the feature would be let in.
- **Derive the mode from `access`:** `public` and `password` project to the same
  value, so the client could not reproduce the stored mode and would downgrade it.
- **Send `access_policy` unconditionally:** an older connector would either
  reject the body or ignore it, and the app cannot know which until it probes.
- **Enforce sharing in the app:** the connector owns the tunnel and the visitor
  session, so a client-side gate would be advisory only.

## Follow-up

- [x] Update the API contract and the Cloud Link product doc.
- [x] Add contract, draft and fake-server coverage plus the browser flows.
- [x] Link this ADR from the change summary.
