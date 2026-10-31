# runtime/

Read [state and data](../docs/architecture/state-and-data.md#state-ownership-overview)
and [feature boundaries](../docs/architecture/feature-boundaries.md).

## Ownership

- `runtime/workspace/workspace-provider.tsx`: registry/focus, root persistence coordination,
  native coordinators, and the single connectivity monitor.
- `runtime/connections/connection-runtime.tsx`: one connection lifecycle/catalog owner.
- `runtime/workspace/workspace-runtime.tsx`: retained connection/project branch.
- `runtime/composition/`: domain wiring, values, reset and cross-feature effects.
- `runtime/persistence/`: app hydration/write-back and cross-domain credential-scope migration.
- `runtime/realtime/`: SSE plus polling reconciliation and coalescing.
- `runtime/presentation/`: stable drafts/scroll positions, independent of registry updates.

Use feature headless APIs for behavior; do not grow domain logic in composition.
Preserve query partitions, cancellation, foreground/demand gates, explicit readiness,
connection-wide catalogs/streams, and independent Settings/Terminal/Chat targets.
Keep one owner per value and the existing provider/context ordering.

`ui.ts` exports only the existing workspace scope/context and update-blocker hook.
Its value imports must never reach root composition, mounts or feature presentation.
No bridge context, state duplication or broader shared UI exception is allowed.

Validate with runtime Vitest, architecture/discovery checks and full E2E. Run the
complete pre-push gate in root guidance; browser/fake-server edits need human validation.
