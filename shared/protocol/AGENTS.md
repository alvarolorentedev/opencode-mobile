# shared/protocol/

Read the [API contract](../../docs/architecture/api-contract.md),
[ADR 0003](../../docs/adr/0003-v2-first-protocol-boundary.md),
and [state model](../../docs/architecture/state-and-data.md).

Own clients, raw normalization, contracts and shared request aggregation. Import no
feature or runtime implementation. V1 SDK imports remain only in `shared/protocol/opencode/compat/v1/`;
compatibility branching remains in adapters/contracts. New API features are V2-only.
Preserve deadlines, retries, auth signals, query partitions and transport cancellation.
Presentation consumes normalized DTOs and pure shared contracts, never these clients.

Validate contract/shared Vitest, fake-server self-tests and full E2E. Preserve fake
server behavior; any edit there requires explicit human validation.
