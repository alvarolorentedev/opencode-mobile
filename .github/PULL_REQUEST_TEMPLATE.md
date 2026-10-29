## Summary

<!-- What changed, and why. Link the issue or ADR when applicable. -->

## Verification

<!-- List the commands and flows you ran. Note anything not run and why. -->

- [ ] `npm run test:ci:static`
- [ ] `npm run test:fake-server:self` when the fake server or protocol changed
- [ ] `npm run test:e2e:web` when a user flow, provider flow, or realtime behavior changed
- [ ] `npm run build:storybook` when a story or Storybook config changed
- [ ] Native/device check when the change touches native modules, permissions, keyboard, safe areas, or store behavior

## Documentation

- [ ] Updated the affected doc in `docs/architecture/`, `docs/product/`, `docs/design/`, or `docs/engineering/`
- [ ] Added or updated an ADR in `docs/adr/` for a durable decision
- [ ] Added or updated a Storybook story for a reusable presentation change
- [ ] Added every new or changed user-facing string to every supported locale and ran `npm run gen:i18n`

## Risk

<!-- What could break, what remains unverified, and what should reviewers focus on? -->

## Human validation

- [ ] Changes under `tests/e2e/` or `tests/fake-opencode/` were explicitly validated by a human
