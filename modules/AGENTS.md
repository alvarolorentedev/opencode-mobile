# Native modules

Read the [native integration reference](../docs/engineering/integrations-and-operations.md)
and [ADR 0016](../docs/adr/0016-supported-expo-native-integrations.md).

Use SDK-compatible Expo APIs first. A local Expo module needs a documented missing
capability; preserve module discovery, registered names, service/task identities
and FOSS exclusions. Keep product policy in its feature and JS native access in
`shared/platform/`. Do not initialize models, microphones or services at import.

Clean up listeners and resources at their existing lifetime. Preserve the
content-capture mitigation immediately after `super.onCreate(null)`; an Activity
listener runs inside the superclass path and is not an equivalent replacement.
Never edit generated native projects as a durable implementation.

Use existing build scripts and the [validation matrix](../docs/engineering/validation/strategy.md).
Debug builds and web tests do not certify R8, permissions, signing or store behavior.
