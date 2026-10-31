## Summary

<!-- What changed, and why. Link the issue or ADR when applicable. -->

## Verification

<!-- List the focused commands and flows you ran. CI is the integration authority. -->

- [ ] `npm run lint` and `npm run typecheck` for touched code
- [ ] `npm run test:ci:static` for broad, provider, protocol, persistence, or architecture changes
- [ ] `npm run test:fake-server:self` when the fake server or protocol changed
- [ ] Affected Playwright spec when a user flow, provider flow, or realtime behavior changed
- [ ] `npm run build:storybook` when a story or Storybook config changed
- [ ] Native/device check when available and relevant; the tag release performs the authoritative native build
- [ ] `ci.yml` is green

Full browser E2E and native release builds run automatically on the `v*` release tag.

## Test decision

<!-- Required when adding or changing a test. "No new test" is valid with a reason. -->

- Test level: unit / integration / contract / E2E / existing coverage / none
- Regression caught:
- Existing coverage checked:
- Why not a cheaper level:
- If no new test: why the current contract is sufficient

## Documentation

- [ ] Updated the affected doc in `docs/architecture/`, `docs/product/`, `docs/design/`, or `docs/engineering/`
- [ ] Added or updated an ADR in `docs/adr/` for a durable decision
- [ ] Added or updated a Storybook story for a reusable presentation change
- [ ] Added every new or changed user-facing string to every supported locale and ran `npm run gen:i18n`

## Risk

<!-- What could break, what remains unverified, and what should reviewers focus on? -->

## Human validation

- [ ] Changes under `tests/e2e/` or `tests/fake-opencode/` were explicitly validated by a human
