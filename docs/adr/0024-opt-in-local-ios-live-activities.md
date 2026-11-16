# ADR 0024: Opt-in local iOS Live Activities

- Status: Accepted
- Date: 2026-11-01
- Deciders: fork implementation; upstream review pending
- Supersedes: —
- Related: [Native integrations](../engineering/integrations-and-operations.md), [iOS parity](../product/parity/ios-widget.md), [ADR 0017](0017-native-defaults-and-prebuilt-engines.md)

## Context

The requested fork needs agent progress on the iPhone Lock Screen and Dynamic
Island, plus a test IPA built without owning a Mac. Android already has a native
activity coordinator and retained, scoped task observations. Duplicating that
state or making the extension fetch from servers would violate ownership and
privacy boundaries.

Expo SDK 58's supported widget package can implement Live Activities, but its
shared JavaScript widget runtime uses an App Group. That provisioning capability
is unavailable to a free Apple Personal Team. This fork needs a small native
ActivityKit surface without that shared-container requirement. No APNs sender,
Apple credentials, paid service, or continuous background delivery is approved
or introduced by this decision.

## Decision

Extend the existing `OpencodeActivity` local module on iOS and generate its
WidgetKit extension through an opt-in CNG plugin. Enable it only with
`EXPO_IOS_LIVE_ACTIVITIES=1`; ordinary store and FOSS configurations retain their
existing targets and behavior. Reuse the current notifications feature owner,
platform adapter, connection-scoped reconciliation, and canonical session links.
The new iOS behavior is V2-only.

The extension receives localized generic state and bounded counts, never session
titles, command/request/reply text, credentials, or server URLs. It contains no
approval, reject, reply, or abort buttons; taps route to the owning session in
the app. Starting requires foreground execution. Backgrounding marks the surface
paused/stale; foreground observations restore verified state. Existing completion
notifications remain independent. No App Group, push entitlement, background
mode, second query owner, or continuous polling service is added.

Canonical connection scopes are reversible encodings, so iOS routes carry a
SHA-256 reference resolved against existing app-owned scopes/profiles after
unlock. No mapping store or connection state is duplicated. The opt-in build
uses a distinct primary URL scheme for activity taps so an installed official
app cannot intercept them, while retaining the ordinary scheme for legacy links.

An optional macOS CI test build may extend the existing iOS build entrypoint to
produce an explicitly unsigned IPA after normal validation. It is not a release,
store upload, signing service, or replacement for the tag-driven release pipeline.

## Consequences

Local native ownership grows only for the missing no-App-Group capability. The
registered Android module, service identities, FOSS exclusions, and default
signed release path stay intact. Test artifacts require local re-signing before
installation; compiling does not prove successful device installation or display.
Upstream acceptance and physical-device privacy, routing, dismissal, and lifecycle
checks remain outstanding until performed.

Continuous updates after suspension or termination still require a separately
approved and provisioned ActivityKit APNs integration. This decision does not
claim to close that remote-delivery gap or the separate home-widget gap.

## Alternatives considered

- **Expo Widgets:** preferred when shared-container provisioning exists; its
  App Group requirement does not meet the Personal Team test-build constraint.
- **Background keepalive or a second polling owner:** rejected because iOS does
  not grant indefinite execution and existing runtime ownership must be retained.
- **Lock Screen action buttons or private previews:** rejected by the existing
  privacy and in-app mutation policy.
- **Unconditional store-release changes:** rejected before native/device and
  provisioning acceptance; the existing tag pipeline stays authoritative.

## Follow-up

- [ ] Validate native compilation and extension embedding in the CI test build.
- [ ] Validate signed installation and Lock Screen/Dynamic Island behavior on an iPhone.
- [ ] Obtain upstream review before enabling this in ordinary store builds.
- [ ] Approve and provision remote APNs separately if continuous delivery is required.
