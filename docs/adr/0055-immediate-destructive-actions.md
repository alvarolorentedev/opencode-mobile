# ADR 0055: Immediate destructive actions without confirmation dialogs

- Status: Accepted
- Date: 2026-11-26
- Deciders: maintainers
- Supersedes: —
- Related: [Design system](../design/design-system.md), [Functional specification](../product/functional-spec.md), [ADR 0023](0023-focused-extension-editors.md), [issue #125](https://github.com/alvarolorentedev/opencode-mobile/issues/125)

## Context

All destructive and data-loss actions (session delete, file discard/replace, worktree remove, provider/service/permission/connection removal, terminal terminate and paste, diagnostics clear, extension edits) went through one shared confirmation dialog (`useConfirmation` over `@rn-primitives/alert-dialog`). On some Android devices (Quest 2, Pixel 10, reporter's phone) the dialog card collapsed to its padding width inside the portal overlay, rendering as a full-height black bar and trapping the user. Two width fixes (a `w-full` class, then an explicit window width) did not hold across devices.

## Decision

Remove confirmation dialogs entirely. Destructive actions run immediately on the first tap. The shared `AlertDialog`, `useConfirmation`, and `useUpdateBlockingConfirmation` are deleted along with the `@rn-primitives/alert-dialog` dependency. Voice-command confirmation in conversation mode is unchanged; it is a separate flow, not this dialog.

## Consequences

- No dialog can collapse, on any device; the portal overlay no longer sizes a centered card.
- Deletes, discards, removals, revocations, terminal terminate and multiline paste are irreversible from the client; there is no undo.
- Terminal paste of control characters or newlines goes straight to the pty.
- E2E cancel-path coverage is rewritten as immediate-effect coverage; `respondToConfirmation` is gone.
- Partially supersedes ADR 0023: dirty extension-editor dismissal no longer requires confirmation. The rest of ADR 0023 stands.

## Alternatives considered

- **Fix the dialog width a third time (stretch layout):** rejected. Two width strategies already failed on real hardware with no local reproduction path; a third guess keeps the failure surface.
- **Replace destructive confirmations with undo windows:** rejected. Server-side deletes have no undo path, so undo would be a false promise.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Rewrote the affected E2E flows; needs explicit human validation per repo policy.
- [ ] Real-device check on the affected phones.
