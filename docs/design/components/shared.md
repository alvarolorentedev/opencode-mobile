# Shared UI And Provider Contracts

Reusable controls, provider/utility modules with UI contracts, and cross-cutting presentation contracts. Back to the [component inventory](../component-inventory.md).

## Shared UI Components

### `components/ui/native-select.tsx`

#### Responsibility

- platform-aware select control

Behavior:

- iOS uses `ActionSheetIOS`
- Android/web use a custom modal sheet
- `searchable` forces the modal sheet on every platform and adds a text
  filter over the option labels (used by the Add provider pickers)
- the searchable modal sheet lifts its options above the soft keyboard via
  `useKeyboardHeight` (transparent `Modal`s cannot use `KeyboardAvoidingView`)
  and shrinks the sheet/list so long filtered lists stay scrollable
- the modal sheet wraps its content in `GestureHandlerRootView` and dismisses on
  a downward header drag via the shared `useSwipeDismiss` helper, matching
  `OverlaySheet`

#### Prop contract

```ts
type NativeSelectProps<T extends string> = {
  disabled?: boolean
  onValueChange: (value: T) => void
  options: NativeSelectOption<T>[]
  renderTrigger: (props: {
    disabled: boolean
    open: () => void
    openState: boolean
    selectedOption?: NativeSelectOption<T>
  }) => ReactNode
  searchable?: boolean
  selectedValue?: T
  title?: string
}
```

### `components/ui/provider-icon.tsx`

#### Responsibility

- render provider-specific icon assets or icon fallbacks

Known image-backed providers include:

- `openai`
- `anthropic`
- `google`
- `groq`
- `openrouter`
- `mistral`
- `xai`
- `azure`
- `github-copilot`
- `github_copilot`
- `github`

Fallback:

- `gitlab` icon
- generic `cube-outline`

### `components/ui/icon-symbol.tsx`

#### Responsibility

- map SF-symbol-style names to Material Icons fallback names

Used primarily by tab icons.

### `components/haptic-tab.tsx`

#### Responsibility

- custom bottom-tab button with iOS haptic feedback on press-in

## Provider And Utility Modules With UI Contracts

### `providers/opencode-provider.tsx`

#### Responsibility

- thin entrypoint that mounts the provider tree with the composition unit's values

Orchestration lives in `providers/use-opencode-provider-composition.ts` and the
context wiring in `providers/opencode-provider-tree.tsx`; the entrypoint is held
to 60 lines by the architecture ratchet and only re-exports the public types.

The public UI contract is exposed through domain hooks from `providers/opencode-contexts.ts` (`useOnboarding`, `useConnection`, `useDiagnostics`, `useCapabilities`, `usePreferences`, `useProjects`, `useProjectFiles`, `useCurrentSession`, `useSessionLibrary`, `useChat`, `useApprovals`, `useConversation`, `useTerminal`, `useMcp`), each typed by its matching `*ContextValue`. There is no combined runtime context value.

### `providers/opencode-provider-types.ts`

#### Responsibility

- define public provider-facing types used across UI

Most important exported contracts:

- `ConversationState`
- `ConnectionState`
- `ProviderOption`
- `ProviderAuthMethod`
- `OpencodeProject`
- the `*ContextValue` domain types

The domain values cover session lifecycle, commands, project editing/worktrees, MCP management, PTY terminal state/actions, diagnostics, global stream status, and OAuth callback completion in addition to chat state.

### `providers/opencode-provider-selectors.ts`

#### Responsibility

- derive current session-scoped interactions, configured providers, transcript activity label, conversation status label, and session previews

### `providers/opencode-preferences.ts`

#### Responsibility

- define the chat preference shape and defaults
- build the reasoning/response-style system prompt

### `providers/opencode-capabilities.ts`

#### Responsibility

- map the resolved contract to server capability flags
- read and merge the auto-approve permission config

### `providers/opencode-model-selection.ts`

#### Responsibility

- define model/agent catalog shapes
- map agents and validate stored/configured provider and model choices

### `providers/opencode-provider-utils.ts`

#### Responsibility

- derive project labels
- group pending interactions by session

### `providers/services/session-service.ts`

#### Responsibility

- aggregate project/session API fetches in small helpers
- expose delete, rename, fork, share/unshare, revert/unrevert, command-list, and command-execution calls

### `providers/services/capabilities-service.ts`

#### Responsibility

- aggregate capability discovery and normalize provider/model/agent lists
- normalize current nested model attachment/input/tool-call/reasoning/status/limit capabilities

### `providers/services/project-service.ts`

#### Responsibility

- expose file find/list/read/status, VCS read/apply, and experimental worktree operations

### `providers/services/mcp-service.ts`

#### Responsibility

- expose MCP status/add/connect/disconnect/OAuth operations
- use config updates for enable/disable and removal

### `providers/services/terminal-service.ts`

#### Responsibility

- expose PTY list/create/update/remove/connect-token operations
- build the ticket-authenticated, project-scoped PTY WebSocket URL

### `providers/services/diagnostics-service.ts`

#### Responsibility

- load health and MCP status independently so one unavailable endpoint does not hide the other

## UX simplification contracts

- `ChatView` creates the shared task-progress FAB and owns progress-overlay visibility. It renders the FAB beside the changes chip when visible; `PendingInteractions` renders it floating at the bottom-right otherwise and retains the detailed progress overlay. The detailed progress overlay remains available. Patch summary chips open the Files changed overlay and select their parent user turn when that message is present in the current session; otherwise the existing changes scope is retained. `TranscriptMessage` memoization includes the review callback to keep the session mapping current.
- The chat library's connection-wide group is Running & recent, with an explicit Running indicator. Deduplicated chats do not create an empty Chats section. Search-empty copy is distinct from a truly empty library.
- `components/project/files-panel.tsx` owns one FlashList for browser entries and changed-file rows, with search, breadcrumbs, status and branch/title content in its header. It renders provider-owned changed-file statuses immediately. Added/modified files use the existing reader; deleted rows explain unavailable content. Button and keyboard search share one guarded handler. Query, submitted query, loading, and failure presentation are local and reset with the connection/project key; results remain provider-owned.
- Setup has one guarded Connect & continue action through `switchConnection`. Input survives failures; connection controls and Skip are disabled while submitting. The shared Cloud Link/Manual chooser precedes the manual form.
- Approval cards separate the current resources from server-provided future `always` patterns and explain that the server controls rule duration. Missing patterns explicitly have unspecified scope. Question descriptions appear before selection, while existing custom/multiple/conditional answer handling remains intact.
- Starter examples fill the draft; the bug example appends a symptoms prompt. Terminal's empty state calls the existing creation handler and describes line-at-a-time commands.
- Icon actions and provider-credential removal expose translated action names. All supported locales carry matching keys and plural forms.
- `app/(tabs)/index.tsx` branches the pre-chat state instead of showing one passive panel: `connecting` and hydration use a spinner, a disconnected server offers `Reconnect` (error) or `Open settings` (idle) plus `Connection settings`, and a connected server without a project opens the shared `ProjectPicker` directly. The workspace manager fails chat focus over to the last healthy connected server before this panel can mistake one failed server for the whole app.
- `providers/use-transcript-read-errors.ts` owns cold transcript read failures independently of the transcript window. Non-silent failures are tagged with the current client, cleared by a successful read, and hidden after a reconnect or server switch. `TranscriptList` renders a retry card for a cold failure with no held records and never falls through to starter prompts. The retry action reuses the inbox-backed transcript read.
- `TranscriptList` exposes `Jump to latest` whenever the list is detached from the tail. New rows switch the label to `New messages`; tapping restores follow mode and saves the restored position. The control floats above the transcript without adding a list row.
- Onboarding permission cards show `Checking…` until status resolves. When the OS will no longer prompt, the enable action becomes `Open settings` via the shared notification/voice setting helpers instead of repeatedly requesting a blocked permission.
- The Connection sheet’s labeled Reconnect action surfaces the returned `ConnectionState` in a snackbar and keeps a two-line connection summary. The reconnect button only indicates an in-flight request while it runs.
- The terminal picker marks the active PTY, shows a per-row opening spinner, repeats the target title and short ID in the close confirmation, and confirms copy with a snackbar.
- Share staging distinguishes `expired` from `discarded`; the close action is non-destructive, while the footer Discard clears the payload. Target loading, failure/retry, empty, selected, and search-empty states live in the conversation picker.
- Chat library rename auto-focuses, supports keyboard submit, offers Cancel, and disables Save for blank or in-flight titles.

Compact control labels scale up to 1.5× (tab-bar labels 1.3×) to keep fixed chrome readable at accessibility text sizes. At font scales above 1.3, the model/reasoning summary moves above the icon toolbar to preserve room for both values. The summary opens the existing model picker and thinking slider; its accessible name includes provider and reasoning. The approval icon toggles directly, the adjacent mode icon opens the agent selector, the left plus always attaches, the microphone always dictates, and the right action starts/stops conversation mode for an empty draft or sends/stops the task. Transcript text continues to use its existing scaling. Full action/model names remain exposed to accessibility.

### `components/ui/numeric-slider.tsx`

The Settings numeric slider is shared with the model picker and is backed by
`@react-native-community/slider` (Expo SDK 57 bundled version). Callers own the
value and updates; the component owns the label/value header and maps the app
palette to the native track and thumb colors. The package supplies the native
interaction and adjustable accessibility semantics. Because its web build does
not expose range semantics or arrow keys, the wrapper forwards
`aria-valuemin/max/now/text` and the previous keyboard stepping behavior.
Settings voice/volume/font controls retain their existing ranges and provider
callbacks.

The composer microphone starts direct speech-to-text dictation into the draft, preserving existing text and never submitting automatically. Empty drafts show the waveform action for conversation mode; text or attachments switch it to Send. Running tasks retain Stop. The top bar has no duplicate voice-chat action; conversation overlay and Back-stop handling remain in the existing header shell.

Composer spacing uses 8px side margins and 6px top/bottom gaps (6px sides and 4px gaps in slim mode), with 8px/4px card top/bottom padding. It does not add another bottom safe-area inset because the visible tab bar owns that inset. Keyboard avoidance and tab visibility remain unchanged.

Task progress is a 48px Paper FAB. When the changes chip is visible, the FAB sits on its right in the same row, vertically centered; symmetric space on the left keeps the chip centered. Without a changes chip, progress floats at the chat area's bottom-right. Its standard circle-slice icon fills in eight stages from the provider-owned completion ratio, becoming a checkmark when all tasks complete. Its translated accessible name contains completed/total counts. Tapping retains the existing detailed overlay. It hides while a permission/question blocks the chat. Only the chip-visible row reserves layout space; the standalone FAB is positioned absolutely on the right and reserves no transcript row or extra padding. Only blocking-card clearance remains.

Changes review dismisses the keyboard without remounting the transcript or composer. Session changes and blocking permission/question requests close review and its source picker. Switching to an empty scope keeps an already open review available; closing it hides the chip until changes exist.

The shared OverlaySheet compact option is opt-in for changes only; other overlays retain their existing height, header, and padding. Compact file rows expose expanded state to accessibility and retain filename-only patch fallback.
