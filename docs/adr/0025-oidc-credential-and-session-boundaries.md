# ADR 0025: OIDC credential and session boundaries with Expo AuthSession

- Status: Accepted
- Date: 2026-11-02
- Deciders: maintainers
- Supersedes: [ADR 0024](0024-oidc-pkce-connection-authorization.md)
- Related: [network resilience](../architecture/network-resilience.md), [state and data](../architecture/state-and-data.md), [library inventory](../engineering/library-extraction.md)

## Context

The initial OIDC implementation could forward access/refresh credentials through
redirects, discard valid refresh tokens on provider outages, and restore a
signed-out session from an old refresh. Main and the contributor branch both
allocated ADR 0023; the contributor's OIDC decision is renumbered 0024 without
changing its original reasoning. Its feature and encrypted persistence contract
remain useful.

## Decision

Use maintained Expo AuthSession for PKCE, state and system-browser coordination.
Keep connection-specific security in the existing session and transport owners.

- Require HTTPS for OIDC issuer, authorization, token and token-bearing server
  URLs, allowing only explicit HTTP loopback development hosts. API credentials
  are restricted to the configured origin and proxy mount. Discovery/token/API
  requests reject redirects using Expo fetch; the nested iOS custom-CA session
  honors Expo's redirect policy before forwarding credentials.
- Allow only the registered `opencodemobile` callback at `oidc-callback`, and
  validate the exact returned target plus OAuth state. HTTPS app links and Expo
  Go callbacks are unsupported because the app does not register them.
- Clear sessions only for definitive `invalid_grant` responses (HTTP 400/401).
  Preserve credentials on temporary and configuration errors, with typed errors
  and no automatic browser launch. Never display untrusted provider error text.
- Coalesce refreshes by the rejected token; generation guards and serialized
  storage protect sign-out, profile removal, replacement and refresh rotation.
  Individual cancellation does not cancel another caller's shared refresh.
- Preserve additive Basic/gateway headers and existing non-OIDC transports,
  profile identity/persistence, Cloud Link, and supported V1/V2 behavior.
- A pinned React Native patch forwards optional WebSocket redirect rejection to
  Android's existing OkHttp client. Only OIDC terminal sockets request it; iOS
  SocketRocket already rejects redirect handshakes. Android builds React Native
  from source through Expo BuildProperties to include the patch. Llama engine
  prebuilts and release ABIs remain unchanged.

## Consequences

Provider outages no longer sign users out and stale work cannot resurrect their
credentials. App-specific trust policy remains necessary around AuthSession.
Android builds are slower until upstream supports per-socket redirect rejection.
A new native build is required; an OTA JS update cannot install the socket fix.
Real-provider device authentication and custom-CA trust still need native checks.

## Alternatives considered

- **Replace the complete session manager with a library:** libraries do not own
  connection-scoped persistence or the app's lifecycle guards.
- **Disable all WebSocket redirects:** changes non-OIDC connection behavior.
- **Patch only Kotlin source while using prebuilt React Native:** does not ship
  the fix. Compile the reviewed upstream source with the small patch instead.
- **Trust returned provider descriptions:** may disclose echoed credentials.

## Follow-up

- [x] Update implementation and dependency documentation.
- [x] Add regression coverage for token destinations, refresh and invalidation.
- [ ] Validate real-provider browser round trips and native redirects on devices.
- [ ] Remove the React Native patch when supported upstream behavior is available.
