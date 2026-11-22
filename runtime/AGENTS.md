# runtime/

Read [state and data](../docs/architecture/state-and-data.md#state-ownership-overview)
and [feature boundaries](../docs/architecture/feature-boundaries.md).

## Ownership

- `runtime/core/`: the app composition root. One Query client for server facts,
  one Zustand store for device facts, and the commands/managers added by
  [ADR 0051](../docs/adr/0051-app-core-state-tiers.md). React mounts it once.
- `runtime/core/commands/workspace.ts`: project demand and readiness, workspace
  focus, local/external navigation, and worktree chat creation.
- `runtime/workspace/workspace-provider.tsx`: coordinates the app-store registry/focus, root persistence,
  native coordinators, and the single connectivity monitor.
- `runtime/connections/connection-lifecycle.ts`: plain connection state
  machine. `create-connection.ts` owns probing, credential renewal, retry, the
  catalog client, realtime transport and Query invalidation. The app core's
  `registry.ts` follows enabled connections and credential revisions.
  `connection-runtime.tsx` adapts lifecycle snapshots and projects the catalog
  alongside the retained project adapters.
- `runtime/workspace/workspace-runtime.tsx`: retained connection/project branch.
- `runtime/composition/`: domain wiring, values, reset and cross-feature effects.
- `runtime/persistence/`: app hydration/write-back and cross-domain credential-scope migration.
- `runtime/realtime/`: SSE plus polling reconciliation and coalescing.
- `runtime/presentation/`: stable drafts/scroll positions, owned by the app store and independent of registry updates.

Server facts belong to Query; device facts belong to the app store. Do not add a
second store or mirror a Query response. Feature domain hooks select the focused
or scoped values from `runtime/core/workspace-scope.ts`; do not add a per-domain
context.

Use feature headless APIs for behavior; do not grow domain logic in composition.
Preserve query partitions, cancellation, foreground/demand gates, explicit readiness,
connection-wide catalogs/streams, and independent Settings/Terminal/Chat targets.
Keep one owner per value and the existing provider/context ordering.

`ui.ts` exports only the existing workspace scope/context and update-blocker hook.
Its value imports must never reach root composition, mounts or feature presentation.
No bridge context, state duplication or broader shared UI exception is allowed.

Validate with runtime Vitest, architecture/discovery checks and the owning E2E flows.
The tag release runs full E2E; browser/fake-server edits need human validation.
