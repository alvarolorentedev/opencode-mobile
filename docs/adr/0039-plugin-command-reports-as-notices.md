# ADR 0039: Plugin command reports as distinct notices

- Status: Accepted
- Date: 2026-11-08
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md), [chat components](../design/components/chat.md), [functional specification](../product/functional-spec.md)

## Context

OpenCode V2 plugins can answer a slash command by posting a report with
`session.prompt({ resume: false, metadata: ... })`. The server stores that report
as a user inbox item. Web and Desktop show it in the chat, and the plugin keeps it
out of model requests. The mobile app previously treated it as a pending user
prompt and, after delivery, as a normal user message. `/quota` from
`@slkiser/opencode-quota` is one example.

The app already renders `synthetic` server notices as display-only text. Plugins
that post user reports do not use that message type, often because notice
placement can be hidden by user settings.

## Decision

Normalize a user-role message as a plugin notice when its metadata is non-empty
and does not contain the composer's `displayText` marker. OpenCode composer
prompts carry `displayText`; mobile and TUI prompts carry no metadata, and plugin
reports carry their own namespaced keys.

At the V2 protocol boundary:

- exclude plugin notices from `promptInbox.list`;
- include them in `promptInbox.listNotices`;
- map delivered user notices to assistant synthetic records with
  `noticeKind: 'plugin'`.

In presentation, render `noticeKind: 'plugin'` with the distinct inline
`NoticeCard`. Existing `synthetic` notices keep the assistant-style notice
rendering. Plugin notices are never read aloud, forked, reverted, counted as
pending work, or used as the session history preview.

## Consequences

- `/quota` and similar plugin reports render as notices without plugin-specific
  code.
- No new state owner, compatibility path, or UI dependency is required.
- A plugin that posts a user message without metadata, or that copies composer
  metadata including `displayText`, remains a user message. Plugins should use
  `session.synthetic` or namespaced metadata for display-only reports.
- The server inbox and model-context behavior are unchanged; only mobile
  classification and presentation change.

## Alternatives considered

- **Keep the user message:** wrong author, fork/revert and read-aloud actions,
  and a misleading pending steer prompt.
- **Require plugins to use `session.synthetic`:** an upstream change for every
  plugin, and notice placement can be hidden by user settings.
- **Reuse the `/btw` overlay:** `/btw` is transient and never added to history;
  a command report should persist in the conversation.
- **Plugin-specific allowlist:** brittle and does not cover plugins with similar
  behavior.

## Follow-up

- [x] Update the API contract, functional specification, and chat component docs.
- [x] Add protocol, presentation, and transcript-row coverage.
- [x] Add the `NoticeCard` Storybook story.
