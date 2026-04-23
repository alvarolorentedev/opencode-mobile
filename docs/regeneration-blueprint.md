# Regeneration Blueprint

## Is The Existing Documentation Enough?

The first documentation pass is strong for maintenance, orientation, and high-level parity.

It is not, by itself, the smallest possible complete spec for regenerating the app from scratch without consulting source code.

What was still missing:

- a full rebuild sequence
- a tighter UI/component inventory
- a more explicit server contract summary
- exact event handling expectations
- a clear list of non-obvious parity traps

This document fills those gaps.

## Recommended Regeneration Strategy

To rebuild a similar app with high fidelity, follow this order:

1. create the Expo app shell and tab navigation
2. implement theme tokens and Paper theme mapping
3. implement the OpenCode client wrapper and connection settings
4. implement the central provider with persistence hydration only
5. add workspace catalog loading and active-project selection
6. add session bootstrapping and session switching
7. add transcript fetch and rendering
8. add prompt send / abort lifecycle
9. add diff and todo rendering
10. add permission/question blocking flows
11. add provider/model/agent capability discovery
12. add settings and provider configuration flows
13. add SSE subscription and polling fallback
14. add notifications
15. add voice input, TTS, working sound, and conversation mode
16. add E2E validation against a fake server

This order mirrors the current implementation's dependency structure and minimizes rework.

## Rebuild Stack

If regenerating a similar app, the closest current stack is:

- Expo Router
- React Native 0.81+
- React 19+
- React Native Paper
- AsyncStorage
- `@opencode-ai/sdk`
- `expo-notifications`
- `expo-background-task`
- `expo-task-manager`
- `expo-speech`
- `expo-speech-recognition`
- `expo-av`
- `expo-document-picker`
- `expo-keep-awake`
- `expo-brightness`

## Directory Blueprint

Closest parity directory layout:

```text
app/
  _layout.tsx
  (tabs)/
    _layout.tsx
    index.tsx
    workspace.tsx
    settings.tsx

components/
  chat/
  settings/
  ui/
  haptic-tab.tsx

providers/
  opencode-provider.tsx
  opencode-provider-types.ts
  opencode-provider-utils.ts
  opencode-provider-selectors.ts
  use-opencode-persistence.ts
  use-conversation-keep-awake.ts
  use-conversation-screen-dim.ts
  services/

lib/
  opencode/
  voice/
  notifications.ts
  storage-keys.ts

constants/
  theme.ts
  paper-theme.ts
```

## UI Inventory

## Tabs

The app has exactly three tabs:

- Chat
- Workspace
- Settings

The tab bar:

- hides on keyboard
- includes haptic feedback on iOS tab press
- uses themed active/inactive colors
- uses safe-area-aware bottom padding

## Chat Screen Inventory

The Chat screen is composed from these visible areas:

1. top app bar
2. session picker sheet
3. optional conversation full-screen overlay
4. two top tabs: `Session` and `Files Changed`
5. transcript or empty state
6. pending interaction cards
7. running status row
8. composer controls row
9. optional conversation banner
10. optional todo summary card
11. attachment chips row
12. voice-status chip row
13. docked prompt composer row
14. snackbar feedback

### Chat Header

Visible behaviors:

- title is the current session title or `Untitled chat`
- tapping title area opens a session picker sheet
- plus button creates a session
- headset button starts conversation mode
- hangup button stops conversation mode

### Session Picker Sheet

Visible behaviors:

- full-width bottom sheet style overlay
- includes `Close` action
- lists non-archived sessions only
- selected session is highlighted
- rows show title and subtitle

### Session Tab

Shows one of:

- empty starter state
- transcript list
- pending interaction cards
- waiting notice
- running notice

### Changes Tab

Shows:

- summary header card
- structured diffs if present
- fallback transcript patch/file details if structured diffs are absent
- empty state if no changes exist

### Composer Controls Row

Contains four controls in one horizontal strip:

- agent picker
- model picker
- reasoning picker
- auto-approve toggle

### Prompt Dock

Contains:

- multiline text input
- secondary button inside the input shell
- primary circular action button outside the input shell

Primary action states:

- `attach`
- `send`
- `stop`

Secondary action states:

- `paperclip`
- `microphone`
- `microphone-off`

## Workspace Screen Inventory

The Workspace screen has:

1. hero/status card
2. `Sync` and `Refresh` actions
3. projects card
4. chats card
5. archived toggle inside chats card

Project rows show:

- project label
- path
- right-side state label: `Active`, `Current`, or `Server`

Session rows show:

- title or `Untitled chat`
- preview or summary subtitle
- relative updated time
- status label
- archive/unarchive action

## Settings Screen Inventory

The Settings screen is a vertical stack of cards:

1. Connection
2. AI defaults
3. Notifications
4. Voice

The provider config dialog is a modal over Settings.

## Server Contract Summary

## Connection Settings Contract

The app needs these user-entered settings:

- `serverUrl`
- `username`
- `password`
- `directory` internally managed by the provider client instances

## Expected Endpoint Families

The client assumes the server can provide:

- path discovery
- project discovery
- session lifecycle
- session runtime status
- session messages
- session diffs
- session todos
- prompt submission
- prompt cancellation
- session summarization
- provider listing
- provider auth metadata
- provider OAuth authorization
- provider auth write
- config read/update
- agent listing
- pending permissions
- pending questions
- event subscription

## Required Session Data Shapes

The app expects sessions to have at least:

- `id`
- optional `title`
- `time.created`
- `time.updated`
- `time.archived`
- optional `summary.files`
- optional `summary.additions`
- optional `summary.deletions`

## Required Message Record Shape

The app expects each message record to look like:

- `info.id`
- `info.role`
- `info.time.created`
- `parts[]`

Optional assistant error shape used by the app:

- `info.error.name`
- `info.error.data.message`

## Required Diff Shape

The structured diff renderer expects each diff item to contain:

- `file`
- `additions`
- `deletions`
- `before`
- `after`

## Required Todo Shape

The todo surface expects each todo item to contain at least:

- `id`
- `content`
- `status`
- optional `priority`

## Pending Permission Shape

The app uses:

- `id`
- `sessionID`
- `permission`
- `patterns[]`
- `always[]`
- optional `tool`

## Pending Question Shape

The app uses:

- `id`
- `sessionID`
- `questions[]`

Each question may contain:

- `question`
- `header`
- `options[]`
- optional `multiple`
- optional `custom`

Each option may contain:

- `label`
- optional `description`

## Event Contract Summary

The provider currently reacts to these event types:

- `session.created`
- `session.updated`
- `session.deleted`
- `session.status`
- `session.idle`
- `message.updated`
- `message.part.updated`
- `message.part.removed`
- `session.diff`
- `todo.updated`
- `permission.updated`
- `permission.replied`

### Expected Event Effects

- session events trigger session list refresh
- `session.status` updates local status map and schedules session-related refreshes
- `session.idle` forces local status to idle and schedules immediate refreshes
- message events schedule message refresh
- `session.diff` and `todo.updated` may update local caches directly
- permission events trigger pending-request refresh

## Non-Obvious Parity Traps

These are the easiest things to miss in a rewrite.

### 1. Two Client Scopes

The app uses both a project-scoped client and a catalog-scoped client.

### 2. Session Bootstrap Is Per Project

The app remembers the last session per project, not one global last session.

### 3. Transcript UI Is Derived, Not Raw

The transcript shown to the user is a filtered transformation of raw message parts.

### 4. Attachments Must Be Re-Encoded

Local file URIs are converted to data URLs before being sent.

### 5. Auto-Approve Is A Server Config Mutation

It is not a purely local convenience toggle.

### 6. Todo Checkbox Interaction Is Local Only

The visible todo checklist in the composer is not persisted back to the server.

### 7. Conversation Mode Depends On Hidden Timer Logic

Recreating only the high-level phases is not enough. The settle timer, restart timer, and cleanup logic matter.

### 8. SSE Failure Must Still Leave The App Functional

The polling safety net is part of parity, not a debug fallback.

### 9. E2E Mode Changes Runtime Side Effects

Notification and voice bootstrap are intentionally skipped in E2E runs.

## Rebuild Acceptance Criteria

A regenerated app should be considered close to parity only if it can do all of the following:

1. connect after hydration without user intervention
2. discover projects and select one
3. reopen the remembered session for that project or create one
4. render transcript, diff, todos, and pending requests
5. send prompts with attachments
6. abort active sessions
7. archive and unarchive sessions
8. configure providers through OAuth and API-key flows
9. update model availability based on configured providers and enabled model list
10. continue functioning when SSE is unavailable
11. notify when tasks finish on supported platforms
12. run the conversation listen -> submit -> wait -> speak loop

## Confidence Level After This Addition

After the existing docs plus this blueprint, the documentation is now much closer to regeneration-grade.

I would still reread implementation files during an actual rebuild for precision, but the docs are now strong enough that I can recreate a very similar app with far less discovery work and much lower risk of missing core behavior.
