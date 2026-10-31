# Native modules

Read the [native integration reference](../docs/engineering/integrations-and-operations.md)
and [ADR 0017](../docs/adr/0017-native-defaults-and-prebuilt-engines.md).

Use SDK-compatible Expo APIs first. A local Expo module needs a documented missing
capability; preserve module discovery, registered names, service/task identities
and FOSS exclusions. Keep product policy in its feature and JS native access in
`shared/platform/`. Do not initialize models, microphones or services at import.

Clean up listeners and resources at their existing lifetime. Preserve the
content-capture mitigation immediately after `super.onCreate(null)`; an Activity
listener runs inside the superclass path and is not an equivalent replacement.
Never edit generated native projects as a durable implementation.

Keep Llama on an exact version with matching upstream engine prebuilts. Never
set `rnllamaBuildFromSource=true` or `RNLLAMA_BUILD_FROM_SOURCE=1`, or bypass a
source-only release's restriction with stale binaries. The existing JNI/ObjC
binding still compiles normally. See the [compatibility decision](../docs/engineering/library-extraction.md#local-classifier-compatibility).

Use existing build scripts and the [validation matrix](../docs/engineering/validation/strategy.md).
Debug builds and web tests do not certify R8, permissions, signing or store behavior.
