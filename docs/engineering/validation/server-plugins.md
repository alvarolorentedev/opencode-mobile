# Real Server Plugin Commands

Back to the [validation index](../testing-and-validation.md).
Compatibility is defined by the [API contract](../../architecture/api-contract.md#server-plugin-commands).

Run `npm run test:plugins:integration` with OpenCode 2 on `PATH`, or set
`OPENCODE_BIN` to its executable. A missing or non-V2 binary fails explicitly.
The runner prints the tested server version; the mobile client uses its pinned
SDK. It runs separately from the deterministic commit gate because that gate
must not require an installed OpenCode server.

`tests/integration/server-plugin-commands.mjs` starts a real loopback server in
temporary, isolated XDG directories with no inherited provider credentials. It
cleans up the process and files on success or failure. The fixture at
`tests/integration/fixtures/command-plugin.mjs` uses the official
`Plugin.define`/`ctx.command.transform()` API. No plugin package is added to
Mobile: the server resolves its plugin API.

The fixture changes session metadata to prove execution happened on the server
without an LLM call. Checks use the production command adapter, installed SDK,
Query options, autocomplete hook and event-resource mapping. They cover command
discovery and descriptions, distinct case-sensitive names, built-in override,
exact arguments, attachment bytes, global/project configuration visibility,
project isolation, command failure and recovery, server prompt hooks, watched plugin reload/removal and
`command.updated`, and a replacement connection partition. Deterministic Vitest
tests additionally cover old responses arriving after a connection/project/auth
switch, demand resubscription, duplicate submission and draft restoration.

Existing fake-server chat, compatibility, interactions, diffs, realtime and
network flows retain the UI/streaming regression contract. A fixture proves
compatibility with the tested server and API, not every third-party plugin.
Native lifecycle behavior, provider-backed generation hooks, third-party
plugin side effects, TUI dialogs and desktop GUI components require their own
acceptance evidence.
