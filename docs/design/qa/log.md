# Design QA log

Completed visual and interaction acceptance reports, newest first where dates
allow. Use [template.md](template.md) and the [QA process](README.md) for new
reviews.

---

# Voice & audio · option 3 design QA

final result: passed

Reviewed 2026-10-29 in the Codex in-app browser. No actionable P0/P1/P2 visual
findings remain in the reviewed app-owned content. This is visual acceptance,
not physical-device microphone, recognition, audio-session or screen-reader acceptance.

## Visual truth and evidence

- Exact selected source: option 3, ImageGen result
  `exec-b7eb02c2-93af-497c-9502-d11e658d0367.png` (1829 × 860 board), under
  `/Users/alvarolorente/.codex/generated_images/01a18641-3d31-72b3-b1d5-1299ea364175/`.
- Production web states: `output/voice-settings-system.jpg` and
  `output/voice-settings-local.jpg`, 390 × 844, density 1. The existing web
  platform gate omits native playback-engine tabs; their conditional content and
  install-before-activation behavior are covered by component contracts.
- Setup: `output/voice-setup-{intro,prepare,profile,test,detected}.jpg`, 390 × 844.
  Later native-only states use the disposable `output/voice-preview-entry.jsx`
  presentation fixture with simulated readiness/permission/audio. It imports the
  production components; it does not establish native recognition quality.
- Narrow/light: `output/voice-setup-light-narrow.jpg`, 320 × 700. Supporting
  content scrolls while Back/Close and the primary footer remain reachable.
- Downloads: `output/voice-downloads.jpg`, 390 × 844; one model dropdown and only
  the selected model's actions. No catalog of expanded model cards remains.
- Opened the source together with the rendered captures in
  `output/voice-compare-{intro,prepare,test}.jpg`. Each source panel is cropped
  inside its app frame and fitted to 390 × 844 beside the density-1 implementation.
  The original board's captions and frame are excluded. Inspected full screens
  and the readable selector/action regions at this scale.

## Findings and fixes

- P1: Paper's web progress wrapper initially expanded to the parent height and
  pushed setup below the fold. A 4-point wrapper now bounds it; revised intro
  and prepare captures show the complete heading/illustration/content hierarchy.
- P2: Mint raster outlines were too pale on light backgrounds. Assets now use
  the active theme tint, verified in the narrow light capture.
- P2: Long compact field labels could crowd the selected value. Labels now have
  a bounded share of the row and both texts may wrap; phone-width dropdowns stay
  within their surface and retain complete accessible names.
- P2: Reusing the outer sheet's scroll target in a full-screen flow would reveal
  the wrong surface. Each flow now owns its SettingsPanel; step changes reset
  that panel while retaining the modal/header.

## Required fidelity surfaces

- Typography: platform/Paper family retained, 24-point bold step headings,
  readable 16-point instructions and 14-point support text. App-owned text wraps.
- Spacing/layout: one header, 16-point gutters, 160-point transparent illustration
  slot, compact model rows, 800-point content cap and pinned primary actions.
- Colors/tokens: semantic app palette and selected accent replace the mock's
  gradient/glow. Light/dark outline and text contrast were visually checked.
- Imagery: four individually generated transparent mint line illustrations,
  1881 × 836 RGBA, theme-tinted through Image. Prompts cover person/speech/phone,
  phone/download tray, person/voiceprint, and phone/waveforms; no baked UI text.
- Copy/content: separate Voice input and Spoken replies; explicit on-device
  prerequisites; optional profile; precise local-recognition/server-request copy;
  Start/Stop/Done and no-submission test guidance. All eight locale catalogs pass.

Intentional house-pattern differences: left-aligned step text, a native progress
bar in place of four decorative pills, standard Paper controls, and one primary
Start test button in place of the mock's second decorative microphone control.
The bubble's wake phrase is localized nearby rather than baked into an image.
The Prepare action requires microphone permission, unlike the static mock's
unconditionally enabled button. These preserve the selected information hierarchy
while using the existing component system. No unresolved P3 follow-up is required.

## Interaction and implementation checklist

Verified System/local presentation switching; opening setup without activation;
Continue/Back/Close; English → Spanish selecting Whisper and changing the missing
size from ~152 MB to ~161 MB; explicit simulated permission/download; optional
profile skip; Start/Stop/detected/Done; and the focused model manager/dropdown.
Unit coverage establishes cancellation, retry, existing-profile preservation,
verification choice preservation, and conversation/test exclusion. Real native
capture, downloads and playback remain physical-device acceptance work.

---

# Cloud Link onboarding design QA

final result: passed

Reviewed 2026-10-13 in the Codex in-app browser. No actionable P0/P1/P2 visual
findings remain. This is QA of app-owned setup content, not acceptance of real
native camera, App Store/Google Play purchases or desktop activation.

## Visual truth and evidence

- Selected design: `output/cloud-link-reference.png` (1704 × 923 pixels), copied
  from the selected illustrated walkthrough refinement. Explicit user changes
  override its uneven heading positions and outlined Restore button: all steps
  share their image/heading/subheading grid; Restore is a text link above Subscribe.
- Implemented states: `output/cloud-link-step-1.png` through
  `output/cloud-link-step-4.png`, each 390 × 844 pixels, CSS viewport 390 × 844,
  deviceScaleFactor 1, dark theme, native store substituted by the existing E2E
  fixture ($4.99/month is test data, not a verified production store price).
- Narrow state: `output/cloud-link-subscription-light-narrow.png`, 320 × 700
  pixels, matching CSS viewport and density 1, light theme.
- Full comparison: `output/cloud-link-review.html`, opened in the in-app browser
  at `http://127.0.0.1:19007/cloud-link-review.html`. Reference and all four
  rendered screenshots were inspected together in a full-page capture. Individual
  panels were also opened at native resolution to inspect price, link targets,
  artwork and text. Reference panels are approximately 400 × 840 within a board;
  gutters, board titles and scale differences are excluded from UI comparison.
- Live app: `http://127.0.0.1:19006/pair` was opened in the in-app browser at
  390 × 844 and 320 × 700. Learn → Computer setup → Subscribe and Back were
  exercised. This unseeded browser correctly reported unavailable development
  store fixtures on Subscribe. Store pricing/purchase/Restore/pairing evidence
  comes from the deterministic existing E2E driver, not a real transaction.
- Browser error logs checked: no uncaught errors in live app or comparison page.
  Temporary viewport overrides were reset after review.

## Required fidelity surfaces

- **Typography:** app display family, 28/34 headings with shared two-line space;
  platform/Paper body typography, normal-sized native offer summary, 16-point
  primary and supporting action labels. Full native store title, price, period
  and any eligible offer phases are retained. No clipped text at checked sizes.
  Platform font metrics intentionally follow the existing app rather than adding
  a font dependency to match a generated bitmap exactly.
- **Spacing:** shared 160-point illustration slot (96 on screens shorter than
  760 points), identical heading/subheading rhythm, 24-point side padding,
  scrollable content, safe-area footer and 50-point primary target. E2E measures
  image/title/subtitle/primary positions across all four steps, within 2 points.
  Restore and pairing-link targets remain at least 44 points high above primary.
- **Colors:** existing charcoal/mint theme tokens; light mode uses the existing
  pale surface and dark teal action color. No new palette, gradients or elevation.
- **Images:** two shared drawings and one generated transparent frame overlay. Learn/Subscribe share the
  devices drawing; Computer setup/Pair share the exact same desktop asset.
  A thin transparent raster corner frame overlays the Pair drawing and scales
  with its illustration slot, leaving the QR code and Cloud Link label clear.
  No photography, screenshot of UI text, custom SVG or code-drawn illustration.
  Artwork is hidden from assistive technology. The depicted QR is decorative.
- **Copy:** explanation, desktop download URL, explicit desktop readiness,
  store checkout hint, live native offers, Restore, QR scanning and desktop
  approval match the agreed flow. Share setup is removed. All new keys exist in
  the eight supported locales. The price summary has no navigation chevron.

## Comparison history

1. Initial fast-flow captures could show the previous illustration while the
   next source loaded. The image now remounts when switching asset families;
   captures wait for the expected asset and decode. Post-fix step 2 and step 4
   show the same desktop drawing, and step 1/3 the same devices drawing.
2. Initial primary controls retained smaller, less rounded default Paper styling.
   Guided primary buttons now share a 25-point radius, 50-point content height
   and 16-point labels; the guided appbar uses centered 18-point text. Other
   Settings subscription callers retain their existing compact presentation.
3. Initial 320 × 700 layout placed pricing below the initial scroll position.
   The shared illustration shrinks to 96 points on short screens. The final
   narrow capture shows title, benefits, native price/period, billing hint,
   Restore and Subscribe together without horizontal overflow. Its flow passes
   action-size/position and price-position assertions and completes Restore.

4. User review identified scanner brackets obstructing the QR code and label.
   Replaced the thick icon with a thin transparent, theme-tinted frame outside
   the display. Its size/position scale with the existing illustration height.
   Fresh 390 × 844 capture shows a clear QR, label and monitor; image/heading
   positions remain unchanged. Lint/typecheck and both focused dark/narrow-light
   flows pass. The screenshot helper reads the shared desktop image first and
   waits for both raster layers to decode; the flow contract remains the same. The user explicitly validated this
   capture-helper adjustment on 2026-10-13. Both focused flows also passed on
   isolated ports after a stale unrelated preview was detected during a rerun.

## Functional validation

- Static CI suite passes (290 Vitest cases plus the existing Node/static checks).
- Both fake server self-tests pass; fake-server contract files are unchanged.
- Full web suite passes 134 flows; after the compact-height visual adjustment,
  all 44 Cloud Link flows pass again, including the fresh visual captures.
- Guided tests cover no implicit purchase/Restore, explicit native purchase,
  pending/canceled checkout remaining on Subscribe, finalization failure,
  subscribers skipping subscription, access loss, camera entry/denial, direct
  link continuation, cancellation clearing the QR, manual chooser continuity,
  native pricing, URL-copy feedback and dark/narrow-light layouts.
- User explicitly validated the revised E2E contract in this chat on 2026-10-13.
- Android development prebuild passes. Gradle compilation stops with
  `SDK location not found`; no Android SDK is configured on this host.

## Follow-up polish and acceptance

The initial bold scanner glyph has been replaced by thin outer-display corners;
the shared computer drawing remains unchanged.
Native font shapes/line wrapping will vary by platform. Physical-device larger
text, VoiceOver/TalkBack, safe areas, keyboard/Back, camera permission and
foreground lifecycle, real store purchase/Restore, and real desktop approval
remain to be checked. These are native acceptance gaps, not passing results.

## Artwork provenance

Built-in Image Gen produced the assets; no CLI/API image-generation fallback.
Final project files:

- `assets/images/cloud-link-devices.png` — 1859 × 846, transparent. Prompt brief:
  laptop → cloud → phone, dotted connection, no captions/UI or phone OS,
  centered horizontal composition for a 342 × 160 slot, mint #7AE7C0 linework,
  dark teal #20302C fill, flat illustration matching the selected design.
- `assets/images/cloud-link-desktop.png` — 1815 × 866, transparent. Prompt brief:
  flat drawn desktop monitor with Cloud Link pairing QR, keyboard and small
  plant, no photography or surrounding UI, only tiny Cloud Link label on the
  monitor, centered horizontal composition for a 342 × 160 slot, same mint/dark
  teal palette; no baked scanner brackets so the asset is reusable.

- `assets/images/cloud-link-scan-frame.png` — 1536 × 1024, transparent.
  Built-in Image Gen prompt: a clean technical UI stencil with four thin black
  right-angle L crop marks, landscape 3:2, uniform 8-pixel strokes and 120-pixel
  arms, square ends/joins, corners inset 32 pixels, empty transparent center,
  no glow/fog/gradient/shadow or central content. The app tints the alpha mask
  with the existing theme color. Earlier mint/glowing variants were not shipped.

## Implementation checklist

Implemented: four guided states, consistent layout, restrained pricing, Restore
link above pinned Subscribe, shared drawings, no Share setup, scanner reuse,
provider-owned checkout/pairing, direct-link origin preservation, recovery,
translations, behavior coverage and implementation docs. No dependency, release
version, persisted schema, protocol endpoint or shared domain store was added.
