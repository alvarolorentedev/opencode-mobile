# Rebuild Checklist

## Purpose

This checklist is intended for rebuilding the current app from scratch while preserving behavioral parity.

Mark each item complete only when the behavior is implemented and manually or automatically verified.

## Phase 1: App Shell

- [ ] Create Expo app with Expo Router entrypoint
- [ ] Add root `app/_layout.tsx`
- [ ] Add tab group `app/(tabs)/_layout.tsx`
- [ ] Add Chat, Workspace, and Settings tab screens
- [ ] Add safe-area support
- [ ] Add React Native Paper provider
- [ ] Add navigation theme provider
- [ ] Add tab icons and haptic tab behavior

## Phase 2: Theme And Visual Foundations

- [ ] Recreate `Colors` token map for light and dark themes
- [ ] Recreate font token map
- [ ] Recreate Paper theme bridge in `constants/paper-theme.ts`
- [ ] Confirm tab bar colors, safe area padding, and keyboard-hide behavior match expectations

## Phase 3: OpenCode Client Layer

- [ ] Implement connection settings shape
- [ ] Implement server URL normalization
- [ ] Implement optional basic auth header generation
- [ ] Implement project-scoped client creation
- [ ] Implement catalog-scoped client creation
- [ ] Implement manual `fetch` wrappers for permissions/questions/archive patching

## Phase 4: Persistence

- [ ] Persist connection settings in AsyncStorage
- [ ] Persist chat preferences in AsyncStorage
- [ ] Persist active project path in AsyncStorage
- [ ] Persist last-session-by-project map in AsyncStorage
- [ ] Persist pending notification session records in AsyncStorage
- [ ] Block auto-connect until hydration finishes

## Phase 5: Provider Foundation

- [ ] Implement `OpencodeProvider`
- [ ] Define connection state
- [ ] Define workspace/session identity state
- [ ] Define per-session caches for messages/diffs/todos
- [ ] Define pending permission/question caches
- [ ] Define capability and preference state
- [ ] Define conversation state
- [ ] Expose typed `useOpencode()` hook

## Phase 6: Workspace Discovery And Session Bootstrapping

- [ ] Load workspace catalog from catalog-scoped client
- [ ] Deduplicate projects by path/worktree
- [ ] Derive project labels from path basename
- [ ] Preserve currently active project when possible
- [ ] Fetch sessions for active project
- [ ] Fetch session statuses
- [ ] Implement `ensureActiveSession()`
- [ ] Reopen remembered session per project when possible
- [ ] Fall back to latest session when remembered session is missing
- [ ] Auto-create session when no session exists

## Phase 7: Capability Discovery

- [ ] Fetch config
- [ ] Fetch providers
- [ ] Fetch provider auth metadata
- [ ] Fetch agents list
- [ ] Flatten provider models into app model options
- [ ] Mark configured providers correctly
- [ ] Reconcile stored mode/provider/model preferences safely
- [ ] Reconcile enabled model IDs safely
- [ ] Reflect auto-approve from config permission state

## Phase 8: Chat Transcript Model

- [ ] Fetch session messages
- [ ] Convert raw message records into transcript entries
- [ ] Support all current part types used by the app
- [ ] Filter transcript to display messages only for main chat bubbles
- [ ] Preserve detail metadata for activity summaries and diff fallback
- [ ] Derive session preview text from latest meaningful message

## Phase 9: Chat Screen UI

- [ ] Recreate top app bar with current session title
- [ ] Recreate session picker sheet
- [ ] Recreate session empty state with starter prompts
- [ ] Recreate paginated transcript list
- [ ] Recreate copy-on-long-press behavior
- [ ] Recreate message summary chips and timestamps
- [ ] Recreate connection issue card
- [ ] Recreate running status row
- [ ] Recreate waiting-for-input notice

## Phase 10: Composer And Prompt Flow

- [ ] Recreate agent picker
- [ ] Recreate model picker
- [ ] Recreate reasoning picker
- [ ] Recreate auto-approve toggle
- [ ] Recreate attachment chips
- [ ] Recreate multiline text composer
- [ ] Recreate inner action button behavior
- [ ] Recreate primary action button behavior
- [ ] Prevent blank prompt submission without attachments
- [ ] Prevent parallel prompt submissions
- [ ] Create/resolve active session before send
- [ ] Convert local file URIs to data URLs before send
- [ ] Pass through remote attachment URLs unchanged
- [ ] Include generated system prompt in prompt body when available
- [ ] Refresh sessions/messages/diffs/todos/pending requests after send
- [ ] Summarize untitled sessions after send when possible
- [ ] Restore draft and attachments on failed send

## Phase 11: Session Control And Workspace Screen

- [ ] Recreate Workspace hero/status card
- [ ] Recreate project list with `Active` / `Current` / `Server` state labels
- [ ] Recreate chats list with preview and relative timestamp
- [ ] Recreate New chat flow in Workspace screen
- [ ] Recreate archive session action
- [ ] Recreate unarchive session action
- [ ] Recreate archived-session visibility toggle
- [ ] Recreate session opening from workspace list
- [ ] Recreate session creation from chat header
- [ ] Recreate session abort flow from composer stop action

## Phase 12: Diff And Todo Surfaces

- [ ] Recreate `Files Changed` top tab
- [ ] Render structured session diffs when available
- [ ] Recreate custom line diff generation from before/after text
- [ ] Recreate collapsed unchanged-context sections
- [ ] Recreate transcript patch/file fallback rendering
- [ ] Recreate no-changes empty state
- [ ] Recreate todo summary card in composer
- [ ] Preserve local-only checkbox interaction behavior for todos

## Phase 13: Pending Interactions

- [ ] Fetch pending permissions for scoped and catalog clients
- [ ] Fetch pending questions for scoped and catalog clients
- [ ] Group pending requests by session
- [ ] Surface current-session pending requests first
- [ ] Recreate permission request card with `Allow once`, `Always allow`, `Deny`
- [ ] Recreate question request card with single/multi select support
- [ ] Recreate custom free-text question answers
- [ ] Disable question submit until all questions are answered
- [ ] Refresh pending requests and messages after replies/rejections

## Phase 14: Realtime Updates

- [ ] Subscribe to event stream when connected and project is active
- [ ] Handle all current event types
- [ ] Update local session status state from events
- [ ] Schedule delayed session refreshes after relevant events
- [ ] Apply direct cache updates for `session.diff` and `todo.updated`
- [ ] Tear down event stream cleanly on unmount or dependency change
- [ ] Track event stream status separately from connection state

## Phase 15: Polling Fallback

- [ ] Add safety polling when SSE is unavailable
- [ ] Keep polling while sessions are busy
- [ ] Keep polling while prompt send is active
- [ ] Keep polling while conversation mode is active
- [ ] Refresh current session content during polling
- [ ] Refresh conversation session content if different from current session
- [ ] Refresh pending requests while fallback polling is needed

## Phase 16: Settings Screen

- [ ] Recreate Connection section
- [ ] Recreate AI defaults section
- [ ] Recreate Notifications section
- [ ] Recreate Voice section
- [ ] Recreate provider configuration dialog
- [ ] Support OAuth provider auth method selection
- [ ] Support manual/API auth method selection
- [ ] Support generic API fallback for providers without auth metadata when appropriate
- [ ] Update provider enablement after successful auth/configuration
- [ ] Keep enabled model selection separate from chosen current model

## Phase 17: Auto-Approve And Permission Config

- [ ] Recreate auto-approve UI toggle in chat composer
- [ ] Patch config permission fields to `allow` when enabled
- [ ] Patch config permission fields to `ask` when disabled
- [ ] Reflect config-derived auto-approve state in chat preferences after capability refresh

## Phase 18: Notifications

- [ ] Initialize notifications outside web and E2E mode
- [ ] Configure Android notification channel
- [ ] Request permissions when needed
- [ ] Track pending session completions on prompt send
- [ ] Flush in-app completion notifications when session becomes idle
- [ ] Register background completion-monitoring task on supported platforms
- [ ] Recheck pending tracked sessions in background task
- [ ] Deep-link to notification settings from Settings screen
- [ ] Deep-link to Android battery settings from Settings screen

## Phase 19: Voice Output

- [ ] Initialize voice audio mode
- [ ] Implement speakable-text normalization
- [ ] Implement TTS voice listing
- [ ] Implement TTS playback with ducking
- [ ] Implement stop-speaking behavior
- [ ] Recreate manual speak/stop control on assistant messages
- [ ] Recreate optional auto-play assistant replies

## Phase 20: Voice Input And Conversation Mode

- [ ] Implement speech-input hook
- [ ] Support on-device recognition preference
- [ ] Support interim and final result handling
- [ ] Recreate draft dictation mode for the composer
- [ ] Implement conversation mode phase state machine
- [ ] Implement final-result settle timeout
- [ ] Implement listening restart timeout
- [ ] Implement assistant baseline tracking for spoken reply detection
- [ ] Stop conversation mode when pending interactions appear
- [ ] Recreate full-screen conversation overlay
- [ ] Recreate keep-awake behavior during conversation mode
- [ ] Recreate brightness dimming behavior during conversation mode
- [ ] Recreate resume-listening-after-reply preference

## Phase 21: E2E And Operational Parity

- [ ] Support E2E mode flag in app config
- [ ] Skip notification initialization in E2E mode
- [ ] Skip voice bootstrap in E2E mode
- [ ] Recreate fake server scenarios or compatible equivalents
- [ ] Recreate Playwright happy-path flow
- [ ] Recreate permission-blocking flow
- [ ] Recreate question-blocking flow
- [ ] Recreate provider-setup flow
- [ ] Recreate SSE-disconnect/polling-fallback flow

## Final Acceptance

- [ ] App reconnects automatically after hydration
- [ ] Workspace selection controls chat context correctly
- [ ] Remembered session is restored per project
- [ ] Prompt send, abort, diff, todo, and pending-request flows all work
- [ ] Provider and model configuration flows work
- [ ] SSE and polling fallback both support functional completion
- [ ] Notifications work on supported builds
- [ ] Conversation mode works end to end
- [ ] Existing documented E2E scenarios pass
