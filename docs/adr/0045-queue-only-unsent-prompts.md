# ADR 0045: Queue only unsent prompts

- Status: Accepted
- Date: 2026-11-17
- Deciders: maintainers
- Supersedes: —
- Related: [Offline prompt queue](../architecture/network-resilience.md#offline-prompt-queue)

## Context

A broken connection can interrupt the response after OpenCode accepts a prompt.
The prompt API assigns the admission ID on the server. Matching by text can
mistake an earlier prompt for a new one, and cannot prove that retrying is safe.

## Decision

Queue a prompt only before its admission request starts. A transport failure
while preparing the agent, model, or instructions can still enter the queue.
Leave admission attempts with an unknown outcome visible as uncertain, with
no automatic retry. Check dismissal again before sending a queued entry.

## Consequences

When reachability reports offline, the app can send the queued prompt once
after reconnect. If reachability lags and a send fails, the user can inspect the
conversation and decide whether to submit a new prompt.

## Alternatives considered

- **Match text and timestamps:** Two intentional sends can share both, and a
  lost response still leaves delivery ambiguous.
- **Use a client-generated request ID:** This would require the server to
  honor the same ID across retries.

## Follow-up

- [x] Cover repeated text, dismissal during a flush, and uncertain delivery.
