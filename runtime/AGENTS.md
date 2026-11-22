# runtime/

Read [state and data](../docs/architecture/state-and-data.md#state-ownership-overview)
and [feature boundaries](../docs/architecture/feature-boundaries.md).

## Ownership

- `runtime/core/`: the app composition root. One Query client for server facts,
  one Zustand store for device facts, and the commands/managers added by
  [ADR 0051](../docs/adr/0051-app-core-state-tiers.md). React mounts it once.
- `runtime/core/commands/workspace.ts`: project demand and readiness, workspace
  focus, local/external navigation, and worktree chat creation.
- `runtime/core/commands/connection.ts`: connection actions, profile activation,
  registry restoration and automatic failover.
- `runtime/workspace/workspace-provider.tsx`: coordinates the app-store registry/focus, root persistence,
  native coordinators, and the single connectivity monitor.
- `runtime/connections/connection-lifecycle.ts`: plain connection state
  machine. `create-connection.ts` owns probing, credential renewal, retry, the
  catalog client, realtime transport and Query invalidation. The app core's
  `registry.ts` follows enabled connections and credential revisions.
  `connection-catalog.tsx` binds lifecycle and catalog data for React; `connection-binding.ts` owns registry/demand hooks.
- `runtime/core/project-runtimes.ts` and `project-binding.ts`: bind retained project
  keys to commands and reconciliation on the connection's realtime manager.
- `runtime/shell/`: app entrypoint, workspace/native/conversation hosts; `runtime/workspace/use-workspace-server-data.ts` owns scoped query demand.
- `runtime/persistence/`: app hydration/write-back and cross-domain credential-scope migration.
- `runtime/realtime/`: SSE plus polling reconciliation and coalescing.
- `runtime/presentation/`: stable drafts/scroll positions, owned by the app store and independent of registry updates.

Server facts belong to Query; device facts belong to the app store. Do not add a
second store or mirror a Query response. Feature domain hooks select the focused
or scoped values from `runtime/core/workspace-selectors.ts`; do not add a per-domain
context.

Use feature headless APIs for behavior; do not grow domain logic in composition.
Preserve query partitions, cancellation, foreground/demand gates, explicit readiness,
connection-wide catalogs/streams, and independent Settings/Terminal/Chat targets.
Keep one owner per value and the existing provider/context ordering.

Validate with runtime Vitest, architecture/discovery checks and the owning E2E flows.
The tag release runs full E2E; browser/fake-server edits need human validation.
