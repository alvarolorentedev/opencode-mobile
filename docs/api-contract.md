# API Contract

## Purpose

This document captures the OpenCode server contract as currently assumed by the mobile app.

It is not an official server API specification. It is the client-side contract required for parity.

Sources for this contract:

- `lib/opencode/client.ts`
- `providers/services/*.ts`
- `providers/opencode-provider.tsx`
- `tests/fake-opencode/server.mjs`
- `tests/fake-opencode/*.mjs`

## Client Construction Contract

The app builds clients with:

- `baseUrl`
- optional `directory`
- optional basic auth header

Client-scoped manual requests also append:

- `Accept: application/json`
- `Content-Type: application/json`
- `Authorization` when password is configured
- `directory=<path>` query parameter when the client is project-scoped

## Connection Settings Shape

```ts
type OpencodeConnectionSettings = {
  serverUrl: string
  username: string
  password: string
  directory: string
}
```

## Endpoint Summary

The mobile app currently depends on these logical endpoints:

- `GET /path`
- `GET /project`
- `GET /project/current`
- `GET /config`
- `PATCH /config`
- `GET /provider`
- `GET /provider/auth`
- `POST /provider/:providerId/oauth/authorize`
- `PUT /auth/:providerId`
- `GET /agent`
- `GET /session`
- `POST /session`
- `GET /session/status`
- `GET /session/:id/message`
- `GET /session/:id/diff`
- `GET /session/:id/todo`
- `POST /session/:id/prompt_async` or equivalent SDK prompt call
- `POST /session/:id/abort`
- `POST /session/:id/summarize`
- `PATCH /session/:id`
- `GET /permission`
- `POST /permission/:id/reply`
- `GET /question`
- `POST /question/:id/reply`
- `POST /question/:id/reject`
- `GET /event`

## Workspace Discovery Endpoints

### `GET /path`

Purpose:

- discover server root path

Expected response shape used by the app:

```json
{
  "directory": "/workspace"
}
```

### `GET /project`

Purpose:

- list server projects/worktrees

Expected response shape used by the app:

```json
[
  {
    "id": "project-demo",
    "worktree": "/workspace/demo-project",
    "time": {
      "created": 1710000000000,
      "initialized": 1710000030000
    }
  }
]
```

### `GET /project/current`

Purpose:

- get current server-side project/worktree

Expected response shape:

```json
{
  "id": "project-demo",
  "worktree": "/workspace/demo-project",
  "time": {
    "created": 1710000000000,
    "initialized": 1710000030000
  }
}
```

## Config Endpoints

### `GET /config`

Purpose:

- fetch current OpenCode config used for provider, model, permission, and agent defaults

Expected response fields used by the app:

- `model`
- `enabled_providers`
- `permission`
- `provider`
- `agent`

Example:

```json
{
  "model": "openai/gpt-4.1-mini",
  "enabled_providers": ["openai"],
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "webfetch": "ask",
    "doom_loop": "ask",
    "external_directory": "ask"
  },
  "provider": {},
  "agent": {
    "build": {},
    "general": {}
  }
}
```

### `PATCH /config`

Purpose:

- update provider enablement or permission policy

Payload patterns currently used:

1. enable provider
2. toggle auto-approve permissions

Example payload for enabling auto-approve:

```json
{
  "permission": {
    "edit": "allow",
    "bash": "allow",
    "webfetch": "allow",
    "doom_loop": "allow",
    "external_directory": "allow"
  }
}
```

Expected response:

- updated config object

## Provider And Agent Endpoints

### `GET /provider`

Purpose:

- list all providers and currently connected providers

Expected response shape:

```json
{
  "all": [
    {
      "id": "openai",
      "name": "OpenAI",
      "models": {
        "gpt-4.1-mini": {
          "id": "gpt-4.1-mini",
          "name": "GPT-4.1 mini",
          "reasoning": true
        }
      }
    },
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "models": {
        "openrouter/auto": {
          "id": "openrouter/auto",
          "name": "Auto",
          "reasoning": false
        }
      }
    }
  ],
  "connected": ["openai"]
}
```

Normalization rules used by the app:

- each provider becomes a `ProviderOption`
- provider models are flattened into `ModelOption[]`
- model IDs are stored as `<providerID>/<modelID>`

### `GET /provider/auth`

Purpose:

- load provider-specific auth metadata

Expected response shape:

```json
{
  "openai": [
    {
      "type": "oauth",
      "label": "Sign in",
      "prompts": []
    }
  ],
  "openrouter": []
}
```

Prompt fields currently supported by the UI:

- `type: "text" | "select"`
- `key`
- `message`
- `placeholder`
- `options[]`
- optional conditional `when`

### `POST /provider/:providerId/oauth/authorize`

Purpose:

- start OAuth flow for a provider auth method

Expected request body shape:

```json
{
  "method": 0,
  "inputs": {}
}
```

Expected response shape:

```json
{
  "url": "https://example.test/oauth/complete",
  "instructions": "Fake OAuth completed in CI."
}
```

### `PUT /auth/:providerId`

Purpose:

- store provider auth credentials

Payload patterns used by the app:

API auth:

```json
{
  "auth": {
    "type": "api",
    "key": "sk-..."
  }
}
```

Wellknown auth:

```json
{
  "auth": {
    "type": "wellknown",
    "key": "some-key-name",
    "token": "some-token"
  }
}
```

Expected response:

```json
{
  "ok": true
}
```

### `GET /agent`

Purpose:

- list available agent modes

Expected response shape:

```json
[
  { "name": "build", "description": "Default build agent" },
  { "name": "general", "description": "General-purpose agent" }
]
```

## Session Endpoints

### `GET /session`

Purpose:

- list sessions for the current scoped project

Expected session fields used by the app:

- `id`
- `title`
- `summary`
- `time.created`
- `time.updated`
- `time.archived`

Example:

```json
[
  {
    "id": "session-1",
    "title": "Stabilize the chat flow",
    "summary": {
      "files": 1,
      "additions": 6,
      "deletions": 1
    },
    "time": {
      "created": 1710000000000,
      "updated": 1710000070000,
      "archived": null
    }
  }
]
```

### `POST /session`

Purpose:

- create a new session, optionally with title

Possible request bodies:

```json
{}
```

or

```json
{
  "title": "My session title"
}
```

Expected response:

- created session object

### `GET /session/status`

Purpose:

- fetch current per-session runtime statuses

Expected response shape:

```json
{
  "session-1": { "type": "idle" },
  "session-2": { "type": "running" }
}
```

The app treats any non-`idle` state as busy.

### `GET /session/:id/message`

Purpose:

- fetch raw message records for transcript derivation

Expected message record example:

```json
[
  {
    "info": {
      "id": "message-1",
      "role": "user",
      "sessionID": "session-1",
      "time": { "created": 1710000000000 }
    },
    "parts": [
      { "type": "text", "text": "Stabilize the chat flow" }
    ]
  },
  {
    "info": {
      "id": "message-2",
      "role": "assistant",
      "sessionID": "session-1",
      "time": { "created": 1710000001000 }
    },
    "parts": [
      { "type": "text", "text": "Finished: task complete." },
      { "type": "patch", "files": ["app/(tabs)/index.tsx"] }
    ]
  }
]
```

Supported part types currently handled by the client:

- `text`
- `reasoning`
- `tool`
- `patch`
- `file`
- `subtask`
- `step-start`
- `step-finish`
- `agent`
- `retry`
- `compaction`

### `GET /session/:id/diff`

Purpose:

- fetch structured file diffs

Example response:

```json
[
  {
    "file": "app/(tabs)/index.tsx",
    "additions": 6,
    "deletions": 1,
    "before": "export default function OldScreen() {}\n",
    "after": "export default function ChatLandingScreen() {\n  return null;\n}\n"
  }
]
```

### `GET /session/:id/todo`

Purpose:

- fetch session todos shown in the chat composer

Example response:

```json
[
  {
    "id": "todo-1",
    "content": "Validate session transcript",
    "status": "completed",
    "priority": "high"
  },
  {
    "id": "todo-2",
    "content": "Confirm fake server integration",
    "status": "completed",
    "priority": "medium"
  }
]
```

### `POST /session/:id/prompt_async`

Purpose:

- submit prompt content to a session

The app also supports SDK variants such as `promptAsync()` or `prompt()`.

Expected request body fields used by the app:

- `agent`
- `model.providerID`
- `model.modelID`
- optional `system`
- `parts[]`

Example request body:

```json
{
  "agent": "build",
  "model": {
    "providerID": "openai",
    "modelID": "gpt-4.1-mini"
  },
  "system": "Reasoning effort: low. Keep the solution direct...",
  "parts": [
    { "type": "text", "text": "Implement the feature" },
    {
      "type": "file",
      "mime": "text/plain",
      "filename": "notes.txt",
      "url": "data:text/plain;base64,SGVsbG8="
    }
  ]
}
```

Expected response in fake server:

```json
{ "accepted": true }
```

### `POST /session/:id/abort`

Purpose:

- cancel an active run

Expected response:

```json
{ "ok": true }
```

### `POST /session/:id/summarize`

Purpose:

- ask server to derive a title for an untitled session

Expected request body shape used by the app:

```json
{
  "providerID": "openai",
  "modelID": "gpt-4.1-mini"
}
```

Expected response:

- updated session or compatible session object

### `PATCH /session/:id`

Purpose:

- archive or unarchive a session

Archive request example:

```json
{
  "time": {
    "archived": 1710000100000
  }
}
```

Unarchive request example:

```json
{
  "time": {
    "archived": null
  }
}
```

Expected response:

- updated session object

## Pending Interaction Endpoints

### `GET /permission`

Expected response example:

```json
[
  {
    "id": "permission-1",
    "sessionID": "session-1",
    "permission": "edit_file",
    "patterns": ["app/(tabs)/index.tsx"],
    "always": [],
    "tool": { "messageID": "tool-message-1", "callID": "tool-call-1" }
  }
]
```

### `POST /permission/:id/reply`

Expected request body shape:

```json
{
  "reply": "once",
  "message": "optional"
}
```

Allowed reply values used by the client:

- `once`
- `always`
- `reject`

Expected response:

```json
{ "ok": true }
```

### `GET /question`

Expected response example:

```json
[
  {
    "id": "question-1",
    "sessionID": "session-1",
    "questions": [
      {
        "question": "Which area should OpenCode stabilize first?",
        "header": "Focus area",
        "options": [
          { "label": "Chat flow", "description": "Keep the prompt-response flow healthy." },
          { "label": "Settings", "description": "Validate provider configuration first." }
        ],
        "multiple": false,
        "custom": true
      }
    ],
    "tool": { "messageID": "tool-message-2", "callID": "tool-call-2" }
  }
]
```

### `POST /question/:id/reply`

Expected request body shape:

```json
{
  "answers": [
    ["Chat flow"]
  ]
}
```

Answer contract:

- outer array aligns with questions in order
- each inner array contains selected labels and optional custom text

Expected response:

```json
{ "ok": true }
```

### `POST /question/:id/reject`

Expected response:

```json
{ "ok": true }
```

## Event Stream Contract

### `GET /event`

Purpose:

- subscribe to server-sent events

The client reacts to event objects with at least:

- `type`
- `properties`

Observed event examples:

```json
{ "type": "session.created", "properties": { "sessionID": "session-1" } }
```

```json
{ "type": "session.status", "properties": { "sessionID": "session-1", "status": { "type": "running" } } }
```

```json
{ "type": "session.idle", "properties": { "sessionID": "session-1" } }
```

```json
{ "type": "message.updated", "properties": { "info": { "sessionID": "session-1" } } }
```

```json
{ "type": "session.diff", "properties": { "sessionID": "session-1", "diff": [] } }
```

```json
{ "type": "todo.updated", "properties": { "sessionID": "session-1", "todos": [] } }
```

```json
{ "type": "permission.replied", "properties": { "requestID": "permission-1" } }
```

## Fake Server Control Endpoint

Used only by tests.

### `POST /__control/reset`

Request body:

```json
{ "scenario": "happy-path" }
```

Response:

```json
{ "data": { "scenario": "happy-path" } }
```

## Client Rules That Depend On The Contract

- project discovery must work without a selected directory
- session-scoped calls must work with a `directory` query parameter or equivalent SDK scoping
- the server must tolerate prompt requests that include a generated `system` field
- session status must be observable either through SSE or refresh polling
- pending interactions must be addressable by request ID
- archive state must round-trip through `time.archived`

## Compatibility Notes

The app intentionally uses permissive `any` types for SDK models. That means runtime contract compatibility matters more than TypeScript compatibility.

For regeneration, matching these response shapes and semantics is more important than reproducing the exact SDK type surface.
