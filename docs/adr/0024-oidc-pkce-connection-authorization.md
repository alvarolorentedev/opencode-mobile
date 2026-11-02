# ADR 0024: Secure OpenID Connect authorization for connections

- Status: Accepted
- Date: 2026-11-02
- Deciders: maintainers
- Supersedes: —
- Related: [network resilience](../architecture/network-resilience.md), [state and data](../architecture/state-and-data.md), [library inventory](../engineering/library-extraction.md), [functional specification § Connection management](../product/functional-spec.md#connection-section), [feature boundaries](../architecture/feature-boundaries.md)

## Context

Manual connections authenticate with basic auth or gateway headers. Servers
behind an identity-aware proxy (Keycloak, Entra ID, Okta, Auth0, Authelia) often
expect a short-lived bearer JWT instead. Asking a mobile user to paste a token is
not viable: tokens expire, cannot be renewed, and end up in screenshots and
clipboard history.

The app already supports per-connection gateway headers in secure storage and a
per-connection custom CA. The connection screen and shared transport are the
natural owners for provider configuration and token use. The flow must protect
credentials across authorization, refresh and API requests, including outages,
redirects, sign-out and connection replacement.

The in-app WebView is not acceptable for sign-in: the app can read everything
typed into it. The token endpoint must never receive a client secret, because a
secret shipped on a phone is not a secret.

## Decision

Support the OAuth 2.0 Authorization Code flow with PKCE for public OpenID
Connect clients, per manual connection. Use maintained `expo-auth-session` for
PKCE, OAuth state and system-browser coordination; keep connection-specific
trust, persistence and session lifecycle rules in the app's existing owners.

- Configure issuer, client ID, scopes, token header and an optional callback
  override as non-secret profile metadata. Require a matching issuer in the
  discovery document. Issuer, authorization, token and token-bearing server
  endpoints require HTTPS, except explicit HTTP loopback development hosts.
- Use the registered `opencodemobile://oidc-callback` app callback, validate the
  exact callback target and OAuth state, and reject ambiguous response
  parameters. HTTPS app links and Expo Go callbacks are unsupported because
  they are not registered.
- Restrict API credentials to the configured secure origin and proxy mount.
  Reject redirects on discovery, token, API and OIDC terminal WebSocket
  requests, including in the iOS custom-CA fetch path. Only OIDC terminal
  sockets request redirect rejection; legacy sockets retain their policy.
- Store tokens with AES-256-GCM via `expo-crypto`; keep the key in SecureStore
  and ciphertext in AsyncStorage, keyed by connection scope, issuer and client
  ID. Refresh 60 seconds before expiry and coalesce requests by the access token
  actually rejected. Session generations and serialized storage operations
  prevent stale refresh/browser work from restoring credentials after sign-out,
  replacement or profile removal. Caller cancellation does not cancel another
  caller's shared refresh.
- Clear a session only for a definitive `invalid_grant` response on HTTP 400 or
  401. Preserve credentials for network, timeout, rate-limit, server,
  malformed-response and configuration failures. Never display untrusted
  provider error text and never open a browser without an explicit user action.
- Send the raw access token in the configured header, defaulting to
  `X-Auth-Request-Access-Token`. Preserve Basic `Authorization` and gateway
  headers; use `Authorization: Bearer` only when no password is configured.
  Retry once after 401/403 only when the request body is absent or a string.
- Android uses a pinned React Native source patch to reject redirects on OIDC
  WebSocket upgrades; iOS already rejects WebSocket redirect handshakes. Build
  React Native from source on Android so the patch ships.
- Affect only the manual V2 connection path. Do not add a V1 adapter; preserve
  Cloud Link, Basic, gateway-header, custom-CA and non-OIDC transport behavior.
  Load the OIDC stack on demand. Web sign-in reports an explicit unsupported
  error because the app cannot intercept its callback there.

## Consequences

- Users can connect to identity-aware servers without copying tokens, and a
  roaming device renews the session without re-opening the browser.
- The mobile app becomes a public OIDC client. Providers must register the
  registered callback and allow PKCE. Providers that require a client secret,
  DPoP, mTLS or another callback scheme are out of scope.
- Provider outages no longer sign users out, and stale work cannot resurrect a
  signed-out or replaced session.
- Android builds take longer while React Native is built from source to include
  the redirect policy patch. Installing the native socket change requires a
  native build; it cannot ship in an OTA JavaScript update.

## Alternatives considered

- **In-app WebView sign-in:** rejected; the app could read the user's password
  and the flow would look like phishing.
- **Paste a JWT manually:** rejected; no renewal, poor usability, and tokens leak
  into clipboard managers.
- **Client-secret (confidential) client:** rejected; a secret on a device is not
  a secret, and PKCE is the correct mechanism for public clients.
- **Hand-written PKCE and browser coordination:** rejected; maintained Expo
  AuthSession already provides these primitives, while app-owned rules still
  handle connection-specific trust and session state.
- **Replace the complete session manager with a library:** rejected; libraries
  do not own connection-scoped persistence or the app's lifecycle guards.
- **Disable all WebSocket redirects:** rejected; this changes non-OIDC
  connection behavior.
- **Trust returned provider descriptions:** rejected; they may disclose
  echoed credentials.
- **Automatic browser popup after a 401:** rejected; it interrupts unrelated
  work and is indistinguishable from an attack when it happens unprompted.
- **Store tokens in SecureStore values:** rejected; JWT plus refresh token
  routinely exceeds SecureStore's 2 KB value guidance on Android. The existing
  certificate store already establishes AES-GCM + SecureStore key as the
  pattern for larger secrets.

## Follow-up

- [x] Update the affected implementation docs and dependency inventory.
- [x] Add contract, transport, session and native regression coverage.
- [ ] Validate real-provider browser round trips and native redirects on devices.
