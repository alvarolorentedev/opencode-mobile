# Design

Back to the [documentation hub](../README.md).

Visual language, reusable components, Storybook, UX proposals, and design QA.

This section is the source of truth for how the app looks, how shared controls
behave, and how design work is validated. It is implementation-facing: every
rule here should map to a token, component, or test in the repository.

## Documents

| Document | Owns |
| --- | --- |
| [design-system.md](design-system.md) | Semantic color, typography, spacing, shape, interaction states, accessibility, settings/search patterns, and feature acceptance |
| [component-inventory.md](component-inventory.md) | Current UI/support component responsibilities and prop contracts |
| [storybook.md](storybook.md) | Running Storybook, writing stories, and deciding what belongs there |
| [qa/README.md](qa/README.md) | Design QA process and evidence requirements |
| [qa/log.md](qa/log.md) | Historical visual acceptance reports |
| [proposals/README.md](proposals/README.md) | Proposal index and status |
| [proposals/worktree-ux.md](proposals/worktree-ux.md) | Worktree/project UX proposal (not implemented) |

## Design workflow

1. **Start from the system.** Use `constants/theme.ts`,
   `constants/appearance.ts`, `constants/paper-theme.ts`, and
   `constants/design-tokens.ts`. Do not introduce literal colors or spacing.
2. **Reuse before adding.** Check the [component inventory](component-inventory.md)
   and the shared settings rows before creating a new control.
3. **Build the component in its correct layer.** Presentation and local UI
   state live in `components/`; provider state and orchestration stay in
   `providers/`. See [architecture](../architecture/README.md).
4. **Add a Storybook story** for reusable primitives and shared controls. See
   [storybook.md](storybook.md).
5. **Validate states, not just the happy path.** Cover loading, empty, disabled,
   error, success, destructive, keyboard, long translations, dark mode, accent
   presets, and narrow widths.
6. **Record visual acceptance** in [qa/log.md](qa/log.md) when a design review
   is part of the change.
7. **Record design decisions** that constrain the system in an
   [ADR](../adr/README.md). A new token family, control primitive, or
   accessibility policy is a decision, not an incidental style change.

## Rules

- Use semantic palette roles through `usePalette()`; never read
  `Colors.light` directly in a component.
- Keep platform fonts. Do not add a font dependency.
- Use MaterialCommunityIcons. A trailing chevron means navigation; a switch
  changes a boolean immediately.
- Preserve accessible targets, labels, checked/expanded/disabled state, and
  visible focus.
- Do not communicate disabled state through opacity alone.
- Do not add decorative motion. Respect reduced motion.
- Every new or changed user-facing string must be translated in every supported
  locale. English fallback in a shipped locale is an incomplete feature.
- Do not put API calls, persistence, or shared domain state in a component.

## Related

- [Functional specification](../product/functional-spec.md) for behavior
- [Architecture](../architecture/README.md) for ownership boundaries
- [Testing and validation](../engineering/testing-and-validation.md) for E2E
  and visual acceptance expectations
