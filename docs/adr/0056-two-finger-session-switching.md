# ADR 0056: Two-finger session switching from the chat screen

- Status: Accepted
- Date: 2026-11-28
- Deciders: maintainers
- Supersedes: —
- Related: [Chat components](../design/components/chat.md), [Functional specification](../product/functional-spec.md), [issue #126](https://github.com/alvarolorentedev/opencode-mobile/issues/126)

## Context

Issue #126 asks for left/right swipes in Chat to switch between sessions without
opening the Chats overlay. The transcript renders markdown through
`react-native-enriched-markdown` with `flavor="github"`: long code lines and wide
tables scroll horizontally inside each message, and message text is selectable.
The OS owns the screen edges for interactive back gestures.

A one-finger horizontal pan attached to the chat screen cannot tell whether a
drag started on ordinary text, a code block, or a table, because the renderer
owns those inner native scroll views. Whichever recognizer wins, the other
interaction stops working. Session switching therefore needs a gesture that
does not overlap one-finger horizontal interactions.

## Decision

Switch to the adjacent session on a two-finger horizontal pan over the chat
screen. The gesture is owned by `features/chat/ui/use-session-swipe.ts` and
mounted once around the visible chat view.

- The current project's top-level sessions are ordered by most recently
  updated; archived and subagent chats are skipped and the ends stop.
- LTR swipes left toward older chats and right toward newer ones; RTL mirrors
  the physical direction.
- The title's accessibility actions expose `Previous chat` and `Next chat` for
  screen-reader users.
- One-finger scrolling, code/table horizontal scrolling, text selection and OS
  edge-back gestures are unchanged. The gesture is not mounted on other tabs,
  where switching would change and hydrate the chat invisibly.

## Consequences

- The feature works across the whole chat screen without a chosen hit area or
  a visible pager.
- Two-finger horizontal swipes are not discoverable on their own; they rely on
  release notes and learned behavior.
- A deliberate two-finger drag starting on a wide table or code block may still
  be consumed by that block's native horizontal scroll view. One-finger
  scrolling remains the normal path.
- The gesture cannot be exercised with a mouse, so browser E2E cannot cover it;
  acceptance is a real-device check plus the pure ordering tests.

## Alternatives considered

- **One-finger swipe across the transcript:** rejected. It makes code blocks
  and tables unscrollable or makes session switching silently miss on them.
- **Header-only one-finger swipe:** rejected as the sole gesture. It is safe but
  too small a target for a chat-wide navigation action.
- **Edge swipe inset from the OS back zone:** rejected. Full-bleed tables and
  code blocks still overlap it, and it is easy to trigger by accident.
- **Visible previous/next buttons or an animated pager:** deferred. They add
  chrome and duplicate the session list; the two-finger gesture keeps the
  current layout.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add pure Vitest coverage for ordering, filtering, and end behavior.
- [ ] Real-device check on Android and iOS for the gesture, code/table
  scrolling, edge-back, text selection, and RTL.
