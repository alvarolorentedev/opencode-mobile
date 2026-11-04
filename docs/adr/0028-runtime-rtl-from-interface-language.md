# ADR 0028: Runtime RTL direction follows the interface language

- Status: Accepted
- Date: 2026-11-04
- Deciders: maintainers
- Supersedes: —
- Related: [Localization integration](../engineering/integrations-and-operations.md#localization), [Design system](../design/design-system.md#accessibility-localization-and-feature-acceptance)

## Context

The persisted interface-language preference can differ from the device locale.
Native RTL detection based only on the device language therefore leaves the app
in the wrong layout direction when the user selects Arabic or Hebrew in app
settings. Expo Router also needs the selected direction for navigation gestures
and transitions.

## Decision

Derive layout and Expo Router direction from the resolved i18n language. Apply
that direction at the app root, modal surfaces, and shared selection and sheet
hosts. Set the web document's `lang` and `dir` attributes from the same resolved
language.

Keep terminal, code, diff, path, URL, and identifier content in its natural
left-to-right order within right-to-left interface copy.

## Consequences

Changing the in-app language updates layout direction with the existing
translation change. Native RTL support remains enabled in the Expo localization
config so system RTL languages are also supported. Shared controls and feature
surfaces must use logical layout and mirror directional navigation affordances.

## Alternatives considered

- **Use only the device locale:** it conflicts with the persisted in-app language
  preference and leaves manually selected RTL languages in LTR layout.
- **Force RTL globally through `I18nManager`:** it persists independently of the
  language choice and takes effect only after an app restart.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Extend the locale catalog and plural-category contract.
- [x] Link this ADR from the localization implementation doc.
