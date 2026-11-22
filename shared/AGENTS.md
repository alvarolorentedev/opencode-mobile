# shared/

Read [feature boundaries](../docs/architecture/feature-boundaries.md). Shared code
provides contracts/infrastructure used across product domains. Its imports stay within shared infrastructure and dependencies. Keep protocol normalization, credential storage and native device resources
in their existing owners. Do not mirror domain state here or introduce new stores.
Run colocated shared tests and the root validation matrix; protocol/storage/query
changes require the complete gate.
