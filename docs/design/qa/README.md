# Design QA

Design QA is the evidence trail for visual and interaction acceptance. It is
not a substitute for physical-device, screen-reader, or store acceptance.

## When to record a review

Record a review when a change:

- introduces or materially changes a shared visual pattern
- adds a new full-screen flow or sheet
- changes responsive, keyboard, safe-area, or large-text behavior
- changes light/dark or accent-preset presentation
- is explicitly reviewed against a design reference

Small copy or token-only changes do not need a separate report unless the
review found something worth preserving.

## Required evidence

- The selected design reference or source, with its location
- The implemented states, with viewport, density, theme, and fixture details
- The comparison method (side-by-side, live app, screenshots)
- Findings by severity (`P0`, `P1`, `P2`, `P3`) and the fix for each
- Intentional differences from the reference and why they preserve the system
- What remains unverified (native microphone, real store purchase, screen
  reader, physical device, and so on)
- The final result: `passed`, `passed with follow-ups`, or `blocked`

Use [template.md](template.md) as the starting point. Append the completed
report to [log.md](log.md) rather than creating a new file per review.

## Rules

- Do not claim screen-reader or native acceptance from screenshots.
- Do not hide unresolved P0/P1 findings behind a "passed" summary.
- Keep evidence paths stable; if an artifact is temporary, say so.
- A design review that changes the system itself needs an
  [ADR](../../adr/README.md).
