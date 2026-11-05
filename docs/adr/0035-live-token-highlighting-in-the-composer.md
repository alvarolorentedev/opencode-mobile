# ADR 0035: Live token highlighting in the composer

- Status: Accepted
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: —
- Related: [Chat components](../design/components/chat.md), [composer accent rules](../../features/chat/model/composer-accent.ts), [composer input](../../features/chat/ui/chat-prompt-input.tsx), [transcript markdown](../../features/chat/ui/chat-markdown.tsx), [ADR 0017](0017-native-defaults-and-prebuilt-engines.md)

## Context

The composer must visually distinguish `@` references, agents, and skills from
leading `/` commands while the user types. React Native's `TextInput` cannot
style substrings, so a plain input can only render one text color. The transcript
already renders through `react-native-enriched-markdown`, which exposes per-link
variants; the composer has no equivalent hook.

A custom overlay (a styled `Text` behind a transparent input with synchronized
scroll) would add selection, caret, wrapping, and scroll-alignment risk on every
platform. The alternative is a maintained native input that owns that behavior.

## Decision

Use `@expensify/react-native-live-markdown` pinned to `0.1.371` for the native
prompt input. The package supports the New Architecture and RN 0.88, and its
custom parser runs as a worklet on the UI thread. `features/chat/ui/chat-prompt-input.tsx`
renders it on iOS and Android and keeps the shared `Input` on web, where the
live highlight is not offered.

The parser in `features/chat/model/composer-accent.ts` emits overlapping `bold`
and `mention-user`/`mention-here` ranges. The package's mention styles only expose
color and background, so the separate bold range is what makes tokens bold in the
theme tint. The input value remains plain text; no prompt or markdown semantics
change.

Import the package's built `MarkdownTextInput` module directly. The package entry
also re-exports its default ExpensiMark parser, which pulls `expensify-common`
and requires a workletized `html-entities`. The app does not use that parser.

Transcript text uses the same token rules. `chat-markdown.tsx` wraps surviving
tokens as `mention:`/`command:` links and styles them through `linkVariants`.
Code spans, fenced blocks, and existing links are masked first and never wrapped.
User bubbles use the dark palette tint because they stay dark in both themes;
flat and assistant bubbles use the active tint.

## Consequences

- The native app gains a native dependency and must be rebuilt. Device validation
  covers typing, IME, paste, selection, the iOS height cap, text scaling, RTL, and
  light/dark/accent themes. The tag release remains the authoritative native build.
- The deep import is deliberate. Keep it pointed at the built module and revisit it
  when the package gains a stable input-only entrypoint.
- The worklet parser skips drafts above 4,000 characters to keep the UI-thread
  scan cheap. Transcript masking uses simple regexes; nested or unclosed Markdown
  code/link constructs are a known limit.
- Web keeps the plain composer, so the accent is native-only there. The transcript
  accent works on all platforms.
- Tokens in bubbles are rendered as links for styling. `onLinkPress` ignores the
  custom schemes, and copy/TTS still use the raw transcript text.
- Dependency review follows ADR 0017: exact version, SDK-compatible package,
  FOSS/license check, and native rebuild.

## Alternatives considered

- **Overlay mirror:** no new dependency and full control, but duplicated text
  layout, caret/selection painting, and scroll synchronization are fragile across
  iOS, Android, and web.
- **`react-native-enriched-markdown` input:** already installed and supports bold
  link variants, but it is native-only and outputs Markdown, which would change
  draft semantics and leave web without an equivalent.
- **WebView rich editor:** heavy runtime, poor input latency, and a large
  accessibility and security surface for a single-line-style prompt.
- **Plain input with no accent:** smallest change, but does not satisfy the
  requested composer affordance.

## Follow-up

- [x] Update the chat and functional-spec documentation.
- [x] Add parser and markdown-style Vitest coverage.
- [ ] Complete native device validation and the release build.
- [ ] Link this ADR from the change summary.
