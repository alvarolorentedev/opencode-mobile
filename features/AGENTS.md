# features/

Start with the owning feature's `AGENTS.md` and [docs router](../docs/README.md).
[Feature boundaries](../docs/architecture/feature-boundaries.md) defines the common
layout, runtime ownership, shared interfaces and enforced import policy.

Use `index.ts` for public consumer UI/types, `context.ts` for existing domain
subscriptions and `runtime.ts` for headless orchestration. Inside a feature, use
its implementation directly. Do not add cycles or private cross-feature imports.
Keep generic controls in shared UI and domain-specific preference fields here.
Runtime mounts domain state; screens never become another shared owner.

Colocate Vitest tests in colocated __tests__/ directories and stories with reusable components. Existing
Playwright flows and fake-server fixtures remain central. Follow the risk-based
validation matrix and preserve the full pre-push gate.
