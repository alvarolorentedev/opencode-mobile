# ADR 0023: OpenID Connect authorization for connections

- Status: Accepted
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [network resilience](../architecture/network-resilience.md), [functional specification § Connection management](../product/functional-spec.md#connection-section), [feature boundaries](../architecture/feature-boundaries.md)

## Context

Manual connections authenticate with basic auth or gateway headers. Servers
behind an identity-aware proxy (Keycloak, Entra ID, Okta, Auth0, Authelia) often
expect a short-lived bearer JWT instead. Asking a mobile user to paste a token is
not viable: tokens expire, cannot be renewed, and end up in screenshots and
clipboard history.

The app already supports per-connection gateway headers in Keychain/Keystore and
a per-connection custom CA. The same screen is the natural place to configure a
provider, and the transport already funnels every request through
`fetchConnection`. What is missing is a standard, phishing-resistant way to
obtain and renew the token, and a rule for what happens when the server rejects
it.

The in-app WebView is not acceptable for sign-in: the app can read everything
typed into it. The token endpoint must never receive a client secret, because a
secret shipped on a phone is not a secret.

## Decision

Support the OAuth 2.0 Authorization Code flow with PKCE for public OpenID
Connect clients, per manual connection.

- Configuration is issuer + client ID + scopes + the request header that
  carries the token, optionally a redirect URI override. The issuer's discovery
  document supplies the authorization and token endpoints, and its `issuer` must
  match the configured value. The header defaults to
  `X-Auth-Request-Access-Token` and carries the raw token (no `Bearer` prefix).
- Sign-in runs in the system browser through `expo-web-browser` and returns to
  the app's own scheme (`opencodemobile://oidc-callback` by default). The app
  never renders credentials, and only a PKCE verifier and state value stay in
  process memory for the round trip.
- Tokens are refreshed silently before expiry and once after a 401/403. A
  failed refresh clears the session and surfaces a `Sign in again` action. The
  app never opens a browser on its own: reconnect, profile rows and the
  connection form start sign-in only from an explicit tap.
- The token is additive. A configured password keeps generating the usual Basic
  `Authorization` header; the JWT travels in the configured token header. Only a
  passwordless connection falls back to `Authorization: Bearer`, so a gateway
  can still read the token there. Gateway headers still apply, and the terminal
  WebSocket upgrade uses the same header set.
- Access and refresh tokens are stored with AES-256-GCM using `expo-crypto`; the
  key lives in SecureStore and the ciphertext in AsyncStorage, keyed by the
  connection scope plus issuer and client ID. The OIDC configuration itself is
  non-secret profile metadata.
- Only the V2 protocol path is affected. Cloud Link and basic-auth connections
  are unchanged, and no new V1 adapter is added.
- The OIDC stack is loaded on demand so connections that do not use it never
  initialize the browser or token-store modules.

## Consequences

- Users can connect to identity-aware servers without copying tokens, and a
  roaming device renews the session without re-opening the browser.
- The mobile app becomes a public OIDC client. Providers must register the
  redirect URI shown on the connection screen and allow PKCE.
- Refresh-token rotation is honored; a provider that rotates tokens invalidates
  the previous refresh token as expected.
- A 401/403 now costs one extra token request before the error surfaces. The
  request replay is limited to requests without a body or with a string body, so
  streamed uploads are never replayed.
- Web builds cannot complete the redirect in this implementation and report an
  explicit unsupported error.
- Providers that require a client secret, DPoP, mTLS, or a fixed native callback
  scheme are out of scope.

## Alternatives considered

- **In-app WebView sign-in:** rejected; the app could read the user's password
  and the flow would look like phishing.
- **Paste a JWT manually:** rejected; no renewal, poor usability, and tokens leak
  into clipboard managers.
- **Client-secret (confidential) client:** rejected; a secret on a device is not
  a secret, and PKCE is the correct mechanism for public clients.
- **Automatic browser popup after a 401:** rejected; it interrupts unrelated
  work and is indistinguishable from an attack when it happens unprompted.
- **Store tokens in SecureStore values:** rejected; JWT plus refresh token
  routinely exceeds SecureStore's 2 KB value guidance on Android. The existing
  certificate store already establishes AES-GCM + SecureStore key as the
  pattern for larger secrets.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add contract and transport tests; keep the browser flow covered by the
  owning manual/E2E flows.
- [ ] Capture the real provider round trip on a device when one is available.
