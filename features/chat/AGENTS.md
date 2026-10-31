# chat

Read the [docs router](../../docs/README.md), [chat reference](../../docs/design/components/chat.md),
and [feature boundaries](../../docs/architecture/feature-boundaries.md).

## Implement here

This feature owns composer, prompt lifecycle, transcript, diffs and replay-safe usage/todo ledgers.
Use ui/ for rendering/local interaction, state/ for domain hooks/actions,
services/ for aggregation/persistence adapters, model/ for pure rules/types,
and __tests__/ for existing owned Vitest coverage. Create no empty scaffolding.
Public entrypoints currently present: `index.ts`, `context.ts`, `runtime.ts`.

Runtime mounts state at the existing application/connection/project lifetime.
Never mount another shared owner in a screen. Consume protocol/storage/platform
interfaces under `shared/`; do not duplicate session catalogs, query responses,
credential stores, retained drafts or native voice/audio resources.

Reuse `shared/ui/` controls and the component inventory. Preference fields specific
to this domain stay here. Cross-feature imports use named public APIs and the
enforced dependency policy; no private imports or cycles.

## Preserve and validate

Preserve cancellation, scope/auth guards, cleanup, persistence formats, localized
copy, text scaling and keyboard/Back/portal behavior. No new V1 compatibility.
Run this feature's colocated Vitest suites, static checks and the owning existing
E2E flows (chat interactions diffs). Reusable UI changes need colocated Storybook stories/build.
State/services changes require full E2E under the validation matrix. Native/device
behavior needs the existing manual checks. Full pre-push gates remain mandatory;
edits to browser/fake-server contracts require explicit human validation.
