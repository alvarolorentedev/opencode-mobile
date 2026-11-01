# ADR 0022: Markdown-first agent and command definitions with JSONC compatibility

- Status: Accepted
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md), [Extensions feature](../../features/extensions/AGENTS.md)

## Context

OpenCode V2 loads agents from `{agent,agents}/**/*.md` and commands from
`{command,commands}/**/*.md`, in addition to the `agents` and `commands` keys in
`opencode.json(c)`. Markdown is the native authoring format for models,
permissions, prompts, and templates, but existing installations already contain
JSONC definitions.

The mobile Extensions surface previously managed commands only through JSONC and
treated file-backed commands as read-only. Adding agents there without changing
the format policy would either keep Markdown users locked out or migrate JSONC
files silently. Automatic migration is unsafe because Markdown directory entries
load after config documents and would override existing definitions.

The V2 API exposes `agent.list` and `command.list`, but neither returns a file
path or command body. File discovery and safe mutation therefore have to happen
through the server filesystem, with the API used as the reload authority.

## Decision

New agent and command definitions default to Markdown in the selected scope:

- project: `.opencode/agents/*.md` and `.opencode/commands/*.md`
- general: `<global config>/agents/*.md` and `<global config>/commands/*.md`

The app also discovers the official `agent` and `command` aliases, and the
legacy `mode`/`modes` agent directories. Markdown files are edited in place
until the user explicitly renames them. Legacy mode directories remain
read-only because the server forces those agents to `primary`.

Existing JSONC `agents` and `commands` definitions stay in JSONC and are edited
through the existing JSONC transaction. A new definition may explicitly choose
JSONC instead of the Markdown default. Nothing is migrated automatically.

When both a JSONC entry and a Markdown file define the same name in one scope,
Markdown is effective because the V2 loader processes the directory entry last.
The JSONC row remains visible as overridden, is not editable, and may be removed
without touching the Markdown file. Creating or renaming onto an existing name
is rejected across both formats and both scopes.

Markdown writes reuse the existing extension safety and transaction rules:
scope-owned paths, system/symlink/permission checks, a same-directory temporary
file, backup, atomic rename, exact-previous-content checking, read-back, server
reload polling, and rollback. Removed files move to `.opencode-mobile-trash`.
Frontmatter is parsed and edited with a real YAML parser; managed scalars and
permissions are validated locally, and generated objects are checked against the
installed OpenCode schema in tests.

## Consequences

- Users get one Extensions surface for both formats without losing existing
  definitions.
- The app depends on the server shell for file listing and mutation, matching
  the existing JSONC extension transaction. Windows and shell-less servers
  remain read-only for Markdown management.
- Command bodies are not exposed by the V2 API, so a body-only command edit can
  be confirmed only by exact file read-back and server name presence. Agent
  instructions can be confirmed through the effective `system` field.
- Duplicate definitions remain a server-side concern. The app detects and labels
  them, but does not choose a winner silently or delete the losing definition.
- Files retain a `.opencode-mobile.bak` backup beside edited Markdown. The
  existing scope-level backup restore UI continues to restore config backups;
  Markdown backups are used for automatic rollback.

## Alternatives considered

- **Convert JSONC definitions to Markdown:** rejected because it silently
  changes precedence and removes user-authored comments and advanced fields.
- **Markdown-only management:** rejected because JSONC is still an officially
  supported V2 configuration format.
- **Parallel extension configuration framework:** rejected because the feature
  already owns a scoped snapshot, serialized mutations, and transaction helpers;
  a second owner would duplicate query and state lifecycles.
- **Hand-written frontmatter parser:** rejected because YAML scalars, nested
  permissions, block values, and alias limits need a real parser to avoid
  corrupting files the server later rejects.

## Follow-up

- [x] Update the API contract, functional specification, and component inventory.
- [x] Add Markdown codec, JSONC agent, snapshot, fake-server, and E2E coverage.
- [x] Link this ADR from the Extensions feature guidance.
