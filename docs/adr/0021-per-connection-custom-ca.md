# ADR 0021: Per-connection custom CA trust

- Status: Accepted
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [network resilience](../architecture/network-resilience.md), [API contract](../architecture/api-contract.md), [known gaps](../engineering/known-gaps.md), [issue #92](https://github.com/alvarolorentedev/opencode-mobile/issues/92)

## Context

Self-hosted OpenCode servers often use a private CA (FreeIPA, step-ca, AD CS)
or a self-signed certificate. Android trusts only system CAs for apps targeting
API 24+, so the connection wizard fails before the user can reach the server.
The issue proposed trusting all user-installed CAs through Android's Network
Security Configuration. That would broaden trust for every host and every
connection, which is not acceptable for an app carrying source code and
developer credentials.

OpenCode 2 is the current contract. OpenCode 1 compatibility remains supported
for existing behavior, but this feature is not added to it: V1 connections keep
their existing system-trust behavior.

## Decision

Allow a user to import a certificate for one manual connection and trust it only
for that connection's `host:port`.

- System trust is always tried first; imported certificates are additive.
- Hostname verification, chain validation and expiry remain mandatory.
- CA, self-signed and non-CA leaf certificates are accepted. Non-CA anchors are
  labelled as pinned server certificates and require re-import on renewal.
- Cloud Link is excluded. Cloudflare terminates its TLS and the connection
  screen never offers the certificate control for Cloud Link profiles.
- V1 connections are excluded from the feature; the certificate is cleared when
  the setup probe detects OpenCode 1.
- Android installs a host-aware `SSLSocketFactory` and
  `X509ExtendedTrustManager` through the existing OkHttp custom-builder and
  factory hooks.
- iOS installs a host-scoped `NSURLProtocol` through the RN and Expo URLSession
  configuration providers, and a host-scoped `SRSecurityPolicy` through
  `RCTSetCustomSRWebSocketProvider`.
- The certificate is stored with AES-256-GCM using `expo-crypto`. The key lives
  in SecureStore and the ciphertext in AsyncStorage. The profile id is GCM
  additional authenticated data.
- `fetchConnection` registers saved trust before each request. Setup probes use
  temporary trust so an unsaved draft is only trusted during the probe.
- A certificate failure is a distinct, non-retryable connection failure kind and
  has actionable copy.

## Consequences

- Private-CA and self-signed V2 servers work on Android and iOS without trusting
  every user CA.
- Other connections, Cloud Link, update checks and unrelated hosts keep normal
  trust.
- The native module is a documented missing capability; it owns device trust
  only. Product policy and storage stay in `features/connections` and `shared/`.
- Certificate rotation for self-signed/non-CA anchors requires re-import.
- `expo-file-system` downloads bypass the custom trust in v1; API, SSE,
  attachments via `expo/fetch`, and WebSockets are covered.
- Revocation/OCSP is not checked.
- Native trust behavior requires device/simulator validation; CI cannot prove it.

## Alternatives considered

- **Global Android Network Security Configuration trusting user CAs:** simplest,
  but expands trust for every host and every connection. Rejected.
- **Certificate pinning packages:** pinning does not add a CA trust anchor and
  does not cover the SDK's SSE and RN WebSocket transports.
- **`react-native-blob-util` custom CA:** closest existing implementation, but
  its certificates are build-time resources and only its own fetch is covered.
- **Patch Expo/RN fetch:** version-fragile and still leaves WebSocket trust
  uncovered.
- **iOS system trust only:** works when the user installs a trusted profile, but
  does not provide connection-scoped inspection and removal.

## Follow-up

- [x] Add the shared certificate contract and encrypted store.
- [x] Add the Android and iOS trust modules.
- [x] Add probe status, error taxonomy and connection-screen controls.
- [x] Preserve V1 system-trust behavior and exclude Cloud Link.
- [ ] Validate on physical Android and iOS devices with a private CA and a
      self-signed certificate.
